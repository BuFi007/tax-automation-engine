import { expect, test } from 'bun:test';
import { createHash, createHmac } from 'node:crypto';
import { approveFacturaEIntent, hashCanonical, type FacturaEIntentV1 } from '@tax-engine/core';
import { handleAccountantInvoiceAuthorityRoute } from './accountant-invoice-authority-routes';
import { handleAccountantInvoiceRoute } from './accountant-invoice-routes';
import { FacturaEAgentService } from './factura-e-agent';
import { FacturaEAuthorityExecutionService, FacturaEAuthorityExecutionStore, type FacturaEAuthorityRemoteEffect } from './authority-execution';
import { TaxProfileStore } from './store';
const owner = '11111111-1111-4111-8111-111111111111';const workspaceId = `personal:${owner}`;
const reviewer = '22222222-2222-4222-8222-222222222222';const firm = '33333333-3333-4333-8333-333333333333';
const runId='44444444-4444-4444-8444-444444444444';const invoiceId='55555555-5555-4555-8555-555555555555';
const secret='s'.repeat(40);const now=new Date('2026-10-13T12:00:00.000Z');const path='/v1/accountant-invoice-authority-approvals';
function fixture(actorId=reviewer) {
  const store=new TaxProfileStore(':memory:');const agent=new FacturaEAgentService(store,null,null);
  const created=store.createFacturaETaxCaseBinding({workspaceId,runId,ledgerInvoiceId:invoiceId,issuancePath:'wsfex_delegated',actorId:owner,idempotencyKey:'case-create-12345678',createdAt:now.toISOString()},()=>agent.createRun({workspaceId,runId,issuancePath:'wsfex_delegated',actorId:owner,idempotencyKey:'case-create-12345678',occurredAt:now.toISOString()}).run);
  const intent:FacturaEIntentV1={version:'factura-e-intent-v1',intentId:invoiceId,workspaceId,taxpayerReferenceHash:'a'.repeat(64),foreignCustomerReferenceHash:'b'.repeat(64),foreignCustomerSafeLabel:'Client',destinationCountry:'US',destinationCountryArcaCode:212,documentType:19,operationType:2,pointOfSale:2,issueDate:'2026-10-13',servicePeriod:{start:'2026-10-01',end:'2026-10-13'},paymentDate:'2026-10-20',sameCurrencyPayment:false,exchangeRate:{decimal:'1200.25',observedForDate:'2026-10-13',sourceReferenceId:'manual-unverified-bna:2026-10-13',authorityRuleDecisionId:'homologation-manual-quote-accountant-review-v1'},lineItems:[{description:'Services',quantity:'1',unitPrice:'100.00',total:'100.00',unitCode:7}],total:{decimal:'100.00',currency:'USD'},serviceDescription:'Services',paymentTerms:'Net7',ruleVersionIds:[]};
  const intentHash=hashCanonical(intent);
  const approved=approveFacturaEIntent({...created.run,intent,intentHash,accountantReviewRequired:true,approvalState:'pending',intentState:'validated',readinessState:'verified'}, {actorId:owner,intentHash,idempotencyKey:'owner-intent-approval-123456',occurredAt:now.toISOString()});
  store.appendFacturaEAgentRevision({run:approved.run,event:approved.event,stateHash:hashCanonical(approved.run),commandHash:'c'.repeat(64),appendedAt:now.toISOString()});
  store.grantAccountantMandate({version:'accountant-mandate-v1',mandateId:'real-client-mandate',workspaceId,accountantActorId:actorId,accountantOrganizationId:firm,scopes:['approve_invoice_intent'],grantedByActorId:owner,grantedAt:'2026-10-12T12:00:00.000Z',expiresAt:'2026-10-14T12:00:00.000Z',revokedAt:null});
  const executionStore=new FacturaEAuthorityExecutionStore(':memory:',false);let effects=0;
  const effect:FacturaEAuthorityRemoteEffect={prepare:async input=>({...input,requestId:'101',authorityPayloadRef:'vault://wsfex/test-payload',authorityPayloadHash:'d'.repeat(64)}),execute:async()=>{effects++;return{status:'authority_accepted_unverified',receiptHash:'e'.repeat(64)};},recover:async()=>({status:'ambiguous',receiptHash:'f'.repeat(64)}),reconcile:async()=>({status:'ambiguous',receiptHash:'f'.repeat(64)})};
  const authority=new FacturaEAuthorityExecutionService(executionStore,id=>agent.getRun(id),effect,true,{environment:'homologation',providerId:'test',approvalPolicy:'mandated_accountant_beta'});
  const execution=authority.createIntent({workspaceId,runId,intentHash,actorId:owner,idempotencyKey:'persist-owner-intent-12345',occurredAt:now.toISOString(),allowAwaitingAccountantReview:true});
  const command={version:'factura-e-accountant-authority-approval-v1' as const,workspaceId,runId,authorityExecutionId:execution.executionId,intentHash,mandateId:'real-client-mandate',idempotencyKey:'real-accountant-review-123456'};
  const beta={enabled:true,deploymentEnvironment:'development',authorityEnvironment:'homologation',workspaceIds:new Set([workspaceId])};
  const options={store,agent,authority,beta,principalSecret:secret,now};
  function request(body:unknown=command,actor=actorId,organization=firm,capability='accountant:decision',boundBody?:string,expiresAt='2026-10-13T12:01:00.000Z') {
    const raw=JSON.stringify(body);const encoded=Buffer.from(JSON.stringify({version:'tax-tenant-principal-v3',workspaceId:organization,actorId:actor,capability,method:'POST',path,bodyHash:createHash('sha256').update(boundBody??raw).digest('hex'),expiresAt})).toString('base64url');
    return new Request(`http://tax.test${path}`,{method:'POST',headers:{'x-tax-tenant-principal':encoded,'x-tax-tenant-signature':createHmac('sha256',secret).update(encoded).digest('hex')},body:raw});
  }
  const approve=(requestInput=request(),overrides={})=>handleAccountantInvoiceAuthorityRoute(requestInput,new URL(requestInput.url),{...options,...overrides});
  const close=()=>{executionStore.close();store.close();};
  return{store,agent,authority,executionStore,execution,command,options,request,approve,close,effects:()=>effects};
}

test('genuine delegated accountant approves frozen owner intent with server-held reference consumed exactly once',async()=>{
  const f=fixture();try{
    expect(f.authority.readiness().humanApproval).toBe('delegated_accountant_required');
    expect(f.execution.nextAction).toBe('request_accountant_authority_approval');
    const before=f.executionStore.get(f.execution.executionId)!;expect(before.createdByActorHash).toBe(hashCanonical(owner));
    expect(()=>f.authority.registerApproval({executionId:f.execution.executionId,workspaceId,intentHash:f.command.intentHash,actorId:owner,approvalRef:'oa_approval_owner_self_attempt',idempotencyKey:'owner-selfapproval-123456',occurredAt:now.toISOString()})).toThrow('TAX_AUTHORITY_BETA_LEGACY_APPROVAL_UNAUTHORIZED');
    expect(()=>f.authority.registerApproval({executionId:f.execution.executionId,workspaceId,intentHash:f.command.intentHash,actorId:reviewer,approvalRef:'human_approval_unmandated_real_reviewer',idempotencyKey:'unmandated-real-reviewer-12345',occurredAt:now.toISOString()})).toThrow('TAX_AUTHORITY_BETA_LEGACY_APPROVAL_UNAUTHORIZED');
    const response=await f.approve();const json=await response!.json();expect(json.data).toMatchObject({version:'factura-e-accountant-authority-approval-receipt-v1',approvalState:'accountant_approved',authorityExecutionId:f.execution.executionId,authorityReceipt:{state:'approved',nextAction:'execute_with_one_use_approval'}});
    expect(JSON.stringify(json)).not.toContain('tax_accountant_approval_');expect(JSON.stringify(json)).not.toContain('approvalRef');
    expect(f.executionStore.get(f.execution.executionId)?.approvalActorHash).toBe(hashCanonical(reviewer));
    expect((await(await f.approve())!.json()).data.replayed).toBe(true);
    await expect(f.approve(f.request({...f.command,idempotencyKey:'changed-accountant-review-12345'}))).rejects.toThrow('TAX_AUTHORITY_APPROVAL_IDEMPOTENCY_CONFLICT');
    const execute={executionId:f.execution.executionId,workspaceId,actorId:owner,idempotencyKey:'owner-executes-approved-1234',occurredAt:now.toISOString()};
    await f.authority.execute(execute);await f.authority.execute(execute);expect(f.effects()).toBe(1);
    await expect(f.authority.execute({...execute,idempotencyKey:'different-execute-key-12345'})).rejects.toThrow('TAX_AUTHORITY_EXECUTION_IDEMPOTENCY_CONFLICT');
    f.store.revokeAccountantMandate('real-client-mandate',workspaceId,owner,now.toISOString());
    await expect(f.approve()).rejects.toThrow('ACCOUNTANT_MANDATE');expect(f.effects()).toBe(1);
  }finally{f.close();}
});

test('accountant authority rejects self, missing/live-expired mandate, wrong firm, wrong tuple, body/capability replay and production',async()=>{
  const self=fixture(owner);try{await expect(self.approve()).rejects.toThrow('TAX_AUTHORITY_SELF_APPROVAL_FORBIDDEN');expect(self.agent.getRun(runId).approvalState).toBe('user_approved');}finally{self.close();}
  const f=fixture();try{
    await expect(f.approve(f.request({...f.command,mandateId:'missing'}))).rejects.toThrow('ACCOUNTANT_MANDATE');
    await expect(f.approve(f.request(f.command,reviewer,'66666666-6666-4666-8666-666666666666'))).rejects.toThrow('ACCOUNTANT_INVOICE_ORGANIZATION_UNAUTHORIZED');
    await expect(f.approve(f.request({...f.command,authorityExecutionId:'77777777-7777-4777-8777-777777777777'}))).rejects.toThrow('TAX_AUTHORITY_EXECUTION_NOT_FOUND');
    await expect(f.approve(f.request({...f.command,intentHash:'f'.repeat(64)}))).rejects.toThrow('ACCOUNTANT_INVOICE_AUTHORITY_BINDING_CONFLICT');
    await expect(f.approve(f.request(f.command,reviewer,firm,'profile:read'))).rejects.toThrow('TAX_TENANT_PRINCIPAL_CAPABILITY_UNAUTHORIZED');
    await expect(f.approve(f.request(f.command,reviewer,firm,'accountant:decision','{}'))).rejects.toThrow('TAX_TENANT_PRINCIPAL_SCOPE_UNAUTHORIZED');
    await expect(f.approve(f.request(),{beta:{...f.options.beta,deploymentEnvironment:'production'}})).rejects.toThrow('ARCA_FISCAL_BETA_CONFIGURATION_REQUIRED');
    await expect(f.approve(f.request(),{beta:{...f.options.beta,workspaceIds:new Set()}})).rejects.toThrow('ARCA_FISCAL_BETA_SCOPE_UNAUTHORIZED');
    await expect(f.approve(f.request(f.command,reviewer,firm,'accountant:decision',undefined,'2026-10-15T12:01:00.000Z'),{now:new Date('2026-10-15T12:00:00.000Z')})).rejects.toThrow('ACCOUNTANT_MANDATE_EXPIRED');
    const unrelated=f.executionStore.create({workspaceId,runId:'88888888-8888-4888-8888-888888888888',intentHash:f.command.intentHash,actorId:owner,idempotencyKey:'other-run-create-123456',occurredAt:now.toISOString(),authorityEnvironment:'homologation',authorityProviderId:'test'});
    await expect(f.approve(f.request({...f.command,authorityExecutionId:unrelated.record.executionId}))).rejects.toThrow('TAX_AUTHORITY_ACCOUNTANT_TARGET_CONFLICT');
    await expect(f.approve(new Request(`http://tax.test${path}`,{method:'POST',headers:{authorization:'Bearer test-api-key'},body:JSON.stringify(f.command)}))).rejects.toThrow('TAX_TENANT_PRINCIPAL_UNAUTHORIZED');
    await expect(f.approve(f.request(f.command,`oa:owner:${reviewer}`))).rejects.toThrow();
    expect(f.agent.getRun(runId).approvalState).toBe('user_approved');expect(f.executionStore.get(f.execution.executionId)?.state).toBe('intent_persisted');expect(f.effects()).toBe(0);
  }finally{f.close();}
});

test('genuine queue exposes exact final target, live mandate and actual creator, including prior semantic approval',async()=>{
  const f=fixture();try{
    const principal={version:'tax-tenant-principal-v2' as const,workspaceId:firm,actorId:reviewer,capability:'accountant:review-queue' as const,expiresAt:'2026-10-13T12:01:00.000Z'};
    const url=new URL(`http://tax.test/v1/accountant-invoice-review-queue?workspaceId=${encodeURIComponent(workspaceId)}`);
    const list=()=>handleAccountantInvoiceRoute(new Request(url),url,f.store,f.agent,principal,now,undefined,{authority:f.authority,beta:f.options.beta});
    expect((await(await list())!.json()).data.items).toMatchObject([{authorityExecutionId:f.execution.executionId,authorityApprovalState:'pending',creatorActorId:owner,mandateConfirmed:true,approvalState:'user_approved'}]);
    f.agent.approveIntentByAccountant({runId,actorId:reviewer,intentHash:f.command.intentHash,idempotencyKey:'genuine-first-semantic-review',occurredAt:now.toISOString()});
    expect((await(await list())!.json()).data.items).toMatchObject([{authorityExecutionId:f.execution.executionId,approvalState:'accountant_approved',authorityApprovalState:'pending'}]);
    const otherReviewer='99999999-9999-4999-8999-999999999999';
    f.store.grantAccountantMandate({version:'accountant-mandate-v1',mandateId:'other-live-client-mandate',workspaceId,accountantActorId:otherReviewer,accountantOrganizationId:firm,scopes:['approve_invoice_intent'],grantedByActorId:owner,grantedAt:'2026-10-12T12:00:00.000Z',expiresAt:'2026-10-14T12:00:00.000Z',revokedAt:null});
    const otherQueue=await handleAccountantInvoiceRoute(new Request(url),url,f.store,f.agent,{...principal,actorId:otherReviewer},now,undefined,{authority:f.authority,beta:f.options.beta});
    expect((await otherQueue!.json()).data.items).toEqual([]);
    await f.approve();expect((await(await list())!.json()).data.items).toEqual([]);
  }finally{f.close();}
});

test('beta rejects imported legacy approvals and both legacy signed principals before any effect',async()=>{
  const {handleFacturaEAuthorityCorridorRoute}=await import('./authority-corridor-routes');
  const {createTaxAuthorityPrincipalHeaders}=await import('./authority-principal');
  const f=fixture();try{
    const legacyPath=`/v1/authority/factura-e/intents/${f.execution.executionId}/approvals`;
    const body={version:'factura-e-authority-approval-register-v1',workspaceId,intentHash:f.command.intentHash,approvalRef:'human_approval_existing_genuine_review',idempotencyKey:'legacy-approval-attempt-12345'};
    const rawBody=JSON.stringify(body);
    for(const actorId of [owner,reviewer]){
      const headers=createTaxAuthorityPrincipalHeaders({secret,workspaceId,actorId,capability:'factura-e:approval:register',method:'POST',path:legacyPath,rawBody,expiresAt:new Date(Date.now()+60_000).toISOString()});
      const request=new Request(`http://tax.test${legacyPath}`,{method:'POST',headers,body:rawBody});
      const response=await handleFacturaEAuthorityCorridorRoute(request,new URL(request.url),f.authority,{corridorEnabled:true,secrets:{motora:secret},beta:f.options.beta,agent:f.agent,store:f.store});
      expect(response?.status).toBe(403);
    }
    const apiKeyOnly=new Request(`http://tax.test${legacyPath}`,{method:'POST',headers:{authorization:'Bearer generic-api-key'},body:rawBody});
    expect((await handleFacturaEAuthorityCorridorRoute(apiKeyOnly,new URL(apiKeyOnly.url),f.authority,{corridorEnabled:true,secrets:{motora:secret},beta:f.options.beta}))?.status).toBe(403);
    // A pre-beta human approval can remain readable, but cannot be consumed as
    // a new mandated beta approval just by being present in the durable store.
    f.executionStore.approve({executionId:f.execution.executionId,workspaceId,intentHash:f.command.intentHash,actorId:reviewer,approvalRef:body.approvalRef,idempotencyKey:'existing-human-approval-12345',occurredAt:now.toISOString()});
    expect(f.executionStore.get(f.execution.executionId)?.approvalSource).toBeNull();
    await expect(f.authority.execute({executionId:f.execution.executionId,workspaceId,actorId:owner,idempotencyKey:'consume-old-human-approval-12345',occurredAt:now.toISOString()})).rejects.toThrow('TAX_AUTHORITY_ACCOUNTANT_APPROVAL_REQUIRED');
    expect(f.effects()).toBe(0);
  }finally{f.close();}
});
