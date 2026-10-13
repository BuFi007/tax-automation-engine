import { expect, test } from 'bun:test';
import { approveFacturaEIntent, hashCanonical, type FacturaEIntentV1 } from '@tax-engine/core';
import { FacturaEAgentService } from './factura-e-agent';
import { TaxProfileStore } from './store';
import { FacturaEAuthorityExecutionService, FacturaEAuthorityExecutionStore, type FacturaEAuthorityRemoteEffect } from './authority-execution';
import { handleFacturaEAuthorityCorridorRoute } from './authority-corridor-routes';
import { createTaxAuthorityPrincipalHeaders } from './authority-principal';
const owner='11111111-1111-4111-8111-111111111111';const other='22222222-2222-4222-8222-222222222222';
const runId='33333333-3333-4333-8333-333333333333';const invoiceId='44444444-4444-4444-8444-444444444444';const secret='s'.repeat(40);
function fixture(team=false) {
 const workspaceId=team?'55555555-5555-4555-8555-555555555555':`personal:${owner}`;
 const beta={enabled:true,deploymentEnvironment:'development',authorityEnvironment:'homologation',workspaceIds:new Set([workspaceId])};
 const store=new TaxProfileStore(':memory:');const agent=new FacturaEAgentService(store,null,null);const occurredAt=new Date().toISOString();
 const create={workspaceId,runId,ledgerInvoiceId:invoiceId,issuancePath:'wsfex_delegated' as const,approvalMode:'owner_manual' as const,actorId:owner,idempotencyKey:'owner-manual-start-123456',createdAt:occurredAt};
 const started=store.createFacturaETaxCaseBinding(create,()=>agent.createRun({...create,occurredAt},beta).run);
 const intent:FacturaEIntentV1={version:'factura-e-intent-v1',intentId:invoiceId,workspaceId,taxpayerReferenceHash:'a'.repeat(64),foreignCustomerReferenceHash:'b'.repeat(64),foreignCustomerSafeLabel:'Client',destinationCountry:'US',destinationCountryArcaCode:212,documentType:19,operationType:2,pointOfSale:2,issueDate:'2026-10-13',servicePeriod:{start:'2026-10-01',end:'2026-10-13'},paymentDate:'2026-10-20',sameCurrencyPayment:false,exchangeRate:{decimal:'1200.25',observedForDate:'2026-10-13',sourceReferenceId:'manual-unverified-bna:2026-10-13',authorityRuleDecisionId:'homologation-manual-quote-accountant-review-v1'},lineItems:[{description:'Services',quantity:'1',unitPrice:'100.00',total:'100.00',unitCode:7}],total:{decimal:'100.00',currency:'USD'},serviceDescription:'Services',paymentTerms:'Net7',ruleVersionIds:[]};
 const intentHash=hashCanonical(intent);
 const approved=approveFacturaEIntent({...started.run,intent,intentHash,approvalState:'pending',intentState:'validated',readinessState:'verified'},{actorId:owner,intentHash,idempotencyKey:'owner-reviews-intent-123456',occurredAt});
 store.appendFacturaEAgentRevision({run:approved.run,event:approved.event,stateHash:hashCanonical(approved.run),commandHash:'c'.repeat(64),appendedAt:occurredAt});
 const executionStore=new FacturaEAuthorityExecutionStore(':memory:',false);let effects=0;
 const effect:FacturaEAuthorityRemoteEffect={prepare:async i=>({...i,requestId:'1',authorityPayloadRef:'vault://manual',authorityPayloadHash:'d'.repeat(64)}),execute:async()=>{effects++;return{status:'authority_accepted_unverified',receiptHash:'e'.repeat(64)}},recover:async()=>({status:'ambiguous',receiptHash:'f'.repeat(64)}),reconcile:async()=>({status:'ambiguous',receiptHash:'f'.repeat(64)})};
 const context={environment:'homologation' as const,providerId:'pilot',approvalPolicy:'mandated_accountant_beta' as const,beta};
 const service=new FacturaEAuthorityExecutionService(executionStore,id=>agent.getRun(id),effect,true,context);
 const execution=service.createIntent({workspaceId,runId,intentHash,actorId:owner,idempotencyKey:'persist-manual-intent-123456',occurredAt});
 const path=`/v1/authority/factura-e/intents/${execution.executionId}/owner-confirmation`;
 const body={version:'factura-e-owner-manual-confirmation-v1',workspaceId,runId,intentHash,confirmation:'issue_exact_frozen_invoice_homologation',idempotencyKey:'confirm-owner-manual-123456'};
 const options={corridorEnabled:true,beta,secrets:{motora:secret},agent,store,environment:'homologation' as const};
 const request=(command=body,actorId=owner,boundBody?:string)=>{const rawBody=JSON.stringify(command);return new Request(`http://tax.test${path}`,{method:'POST',headers:createTaxAuthorityPrincipalHeaders({secret,workspaceId,actorId,capability:'factura-e:approval:register',method:'POST',path,rawBody:boundBody??rawBody,expiresAt:new Date(Date.now()+60000).toISOString()}),body:rawBody})};
 const confirm=(req=request(),opts=options)=>handleFacturaEAuthorityCorridorRoute(req,new URL(req.url),service,opts);
 return{workspaceId,beta,store,agent,create,intentHash,service,executionStore,execution,body,options,request,confirm,effects:()=>effects,context,effect,close:()=>{store.close();executionStore.close()}};
}
test('Personal and B2B owner manually confirms exact frozen intent with honest provenance and one-use execution',async()=>{
 for(const team of [false,true]){const f=fixture(team);try{
  expect(f.agent.getRun(runId)).toMatchObject({approvalMode:'owner_manual',accountantReviewRequired:false,approvalState:'user_approved',issuanceState:'ready_for_wsfex'});
  expect(f.execution).toMatchObject({approvalMode:'owner_manual',nextAction:'request_owner_manual_confirmation'});
  const response=await f.confirm();expect(response?.status).toBe(200);const json=await response!.json();expect(json.data).toMatchObject({approvalMode:'owner_manual',state:'approved',replayed:false});
  expect(JSON.stringify(json)).not.toContain('approvalRef');expect(JSON.stringify(json)).not.toContain('tax_owner_manual_approval');
  expect(f.executionStore.get(f.execution.executionId)).toMatchObject({approvalSource:'owner_manual_beta',createdByActorHash:hashCanonical(owner),approvalActorHash:hashCanonical(owner)});
  expect((await(await f.confirm())!.json()).data.replayed).toBe(true);
  expect((await f.confirm(f.request({...f.body,idempotencyKey:'changed-owner-confirmation-123456'})))?.status).not.toBe(200);
  const execution={executionId:f.execution.executionId,workspaceId:f.workspaceId,actorId:owner,idempotencyKey:'owner-manual-execute-123456',occurredAt:new Date().toISOString()};
  await expect(f.service.execute({...execution,actorId:other})).rejects.toThrow();expect(f.effects()).toBe(0);
  await f.service.execute(execution);await f.service.execute(execution);expect(f.effects()).toBe(1);
  await expect(f.service.execute({...execution,idempotencyKey:'changed-manual-execute-123456'})).rejects.toThrow('IDEMPOTENCY_CONFLICT');
 }finally{f.close()}}
});
test('owner manual cannot change frozen mode, owner, tuple, confirmation, signed body, deployment or issuer environment',async()=>{
 const f=fixture(true);try{
  const {approvalMode: _approvalMode, ...legacyCreate} = f.create;
  expect(()=>f.store.createFacturaETaxCaseBinding(legacyCreate,()=>f.agent.getRun(runId))).toThrow('BINDING_CONFLICT');
  for(const req of [f.request(f.body,other),f.request({...f.body,runId:'66666666-6666-4666-8666-666666666666'}),f.request({...f.body,intentHash:'f'.repeat(64)}),f.request({...f.body,confirmation:'anything_else'}),f.request(f.body,owner,'{}'),new Request(f.request().url,{method:'POST',headers:{authorization:'Bearer key'},body:JSON.stringify(f.body)})])expect((await f.confirm(req))?.status).not.toBe(200);
  for(const deploymentEnvironment of ['staging','production'])expect((await f.confirm(f.request(),{...f.options,beta:{...f.beta,deploymentEnvironment}}))?.status).not.toBe(200);
  expect((await f.confirm(f.request(),{...f.options,beta:{...f.beta,enabled:false}}))?.status).not.toBe(200);
  expect((await f.confirm(f.request(),{...f.options,beta:{...f.beta,authorityEnvironment:'production'}}))?.status).not.toBe(200);
  expect((await f.confirm(f.request(),{...f.options,beta:{...f.beta,workspaceIds:new Set()}}))?.status).not.toBe(200);
  await f.confirm();
  for(const beta of [{...f.beta,deploymentEnvironment:'production'},{...f.beta,deploymentEnvironment:'staging'},{...f.beta,enabled:false},{...f.beta,authorityEnvironment:'production'}]){
    const denied=new FacturaEAuthorityExecutionService(f.executionStore,id=>f.agent.getRun(id),f.effect,true,{...f.context,beta});
    await expect(denied.execute({executionId:f.execution.executionId,workspaceId:f.workspaceId,actorId:owner,idempotencyKey:'denied-owner-execute-123456',occurredAt:new Date().toISOString()})).rejects.toThrow('BETA_CONFIGURATION_REQUIRED');
  }
  expect(f.effects()).toBe(0);
 }finally{f.close()}
});
