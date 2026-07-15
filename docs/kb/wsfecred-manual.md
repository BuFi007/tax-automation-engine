# WSFECRED — Factura de Crédito Electrónica MiPyME — Manual para el desarrollador

> **Source (authoritative):** https://servicioscf.afip.gob.ar/facturadecreditoelectronica/documentos/Manual-Desarrollador-WSFECRED.pdf
> **Retrieved:** 2026-07-15
> **Conversion:** Firecrawl scrape (official PDF, 87 pages, Last-Modified 2024-05-16).
>
> **WARNING:** This markdown is a convenience copy for search/reference only. The
> official document at the source URL is authoritative. Exact-recovery details and
> fiscal rules MUST be verified against it before implementation.

# FACTURA ELECTRÓNICA de CRÉDITO MiPyMEs

# WEB SERVICE FECredService

## Manual para el Desarrollador

## V 2.0.3

---

Contenido

1 Introducción.....4
1.1 Objetivo.....4
    1.1.1 Funcionalidad.....4
1.2 Estructura general del mensaje de Respuesta (response).....5
1.3 Tratamiento de errores.....6
    1.3.1 Tratamiento de errores excepcionales.....6
    1.3.2 Tratamiento de errores en el WS por validaciones de formato.....6
        1.3.2.1 Aclaração importante: Elemento IdCtaCte.....7
        1.3.3 Tratamiento de errores por validaciones del negocio.....9
        1.3.4 Tratamiento de observaciones validaciones del negocio.....10
1.4 Tratamiento de eventos.....11
1.5 Operatoria.....12
    1.5.1 Estados.....12
1.6 Manejo transaccional.....15
2 Web Services de Negocio.....16
2.1 Direcciones URL.....16
2.2 Situ de consulta y canal de atención.....16

---

2.4.10 Consultar Cuentas Corrientes (consultarCtasCtes) ..... 39
2.4.10.1 Mensaje de Solicitud ..... 39
2.4.10.2 Mensaje de Respuesta ..... 40
2.4.10.3 Observaciones ..... 41
2.4.10.4 Validaciones excluyentes ..... 41
2.4.11 Consultar Cuenta Corriente (consultarCtaCte) ..... 42
2.4.11.1 Mensaje de Solicitud ..... 42
2.4.11.2 Mensaje de Respuesta ..... 42
2.4.12 Consultar Cuentas En Agentes de Depósito Colectivo (consultarCuentasEnAgtDptoCltv) 44
2.4.12.1 Mensaje de Solicitud ..... 44
2.4.12.2 Mensaje de Respuesta ..... 44
2

---

#### Estructura general del mensaje de Respuesta (response)

# Introducción

## 1.1 Objetivo

Brindar la información necesaria para desarrollar un cliente del Web Service para la Gestión de cuentas corrientes que se originan a partir de las emisiones de Facturas Electrónicas de *Crédito (FECRED).*

### 1.1.1 Funcionalidad

Comprende desde la definición del WSDL hasta las validaciones de negocio que realizará cada servicio.

El presente WS permite llevar a cabo las siguientes operaciones:

- Aceptar Factura Electrónica de Crédito
- Rechazar Factura Electrónica de Crédito
- Rechazar Nota de Débito o Crédito
- Informar Factura a Agente de Deposito Colectivo
- Informar Cancelación Total de la Factura Electrónica de Crédito
- Modificar Opción de Transferencia de una Factura Electrónica de Crédito
- Consultar: o Comprobantes o Cuentas Corrientes o Cuenta Corriente o Cuentas En Agentes de Depósito Colectivo o Obligado Recepción o Tipos de Retenciones o Tipos de Motivos de Rechazo o Facturas informadas al Agente de Deposito Colectivo o Tipos de Formas de Cancelación o Remitos Asociados a un Comprobante o Historial de Estados de un Comprobante o Historial de Estados de una Cuenta Corriente o Tipos de Ajuste de Operación o Monto Obligado a Recepción
- dummy
Este documento debe complementarse con el documento relativo al SERVICIO DE AUTENTICACION DE CONTRIBUYENTES DE AFIP y Resoluciones Generales que norman los proyectos pertinentes.

#### 4 de 88

---

## Estructura general del mensaje de Respuesta (response)

# 1.2 Estructura general del mensaje de Respuesta (response)

Los mensajes de respuesta que se transmiten tienen implementado el subelemento opcional <Header>, que se contempla en la estructura SOAP. En este webservice se utiliza para brindar información contextual relacionada con el proceso del mensaje. El procesamiento de dicha información no es obligatoria en los respectivos clientes, pero contribuye con información contextual de procesamiento que es de utilidad ante posibles eventualidades.

Ejemplo de mensaje de respuesta en el ambiente de Testing <?xml version='1.0' encoding='UTF-8'?> <S:Envelope xmlns:S="[http://schemas.xmlsoap.org/soap/envelope/"](http://schemas.xmlsoap.org/soap/envelope/")> **<S:Header>** **<info xmlns="[https://ar.gob.afip.wsfecred/FECredService/"](https://ar.gob.afip.wsfecred/FECredService/")>** **<ambiente>Testing-vii</ambiente>** **<fecha>2018-06-22T17:49:06.970-03:00</fecha>** **</info>** **</S:Header>** </S:Body> . . . </S:Body> </S:Envelope>

Ejemplo de mensaje de respuesta en el ambiente de Producción <?xml version='1.0' encoding='UTF-8'?> <S:Envelope xmlns:S="[http://schemas.xmlsoap.org/soap/envelope/"](http://schemas.xmlsoap.org/soap/envelope/")> **<S:Header>** **<info xmlns="[https://ar.gob.afip.wsfecred/FECredService/"](https://ar.gob.afip.wsfecred/FECredService/")>** **<ambiente>Produccion-bus</ambiente>** **<fecha>2018-06-22T17:49:06.970</fecha>** **<id>v1.0.0</id>** **</info>** **</S:Header>** </S:Body> . . . </S:Body> </S:Envelope>

## 5 de 88

---

### Tratamiento de errores en el WS por validaciones de formato

# 1.3 Tratamiento de errores

En éste WS existen tres tipos de errores que hacen que se genere un rechazo a los requerimiento del cliente, los mismo son: Errores Excepcionales, Errores de Formato y Errores de Negocio.

## 1.3.1 Tratamiento de errores excepcionales

Los errores excepcionales serán del tipo descriptivo y tendrán el siguiente tratamiento: <S:Envelope xmlns:S= "[http://schemas.xmlsoap.org/soap/envelope/"](http://schemas.xmlsoap.org/soap/envelope/")> <S:Body> <ns2:Fault xmlns:ns2="[http://schemas.xmlsoap.org/soap/envelope/"](http://schemas.xmlsoap.org/soap/envelope/") xmlns:ns3="[http://www.w3.org/2003/05/soap-envelope"](http://www.w3.org/2003/05/soap-envelope")> <faultcode>ns3: Receiver</faultcode> <faultstring>[wscommon_007] La firma no corresponde al token enviado.</faultstring> </ns2:Fault> </S:Body> </S:Envelope> Dónde: **<faultstring> es del tipo string** Describe al error que se generó al procesar la solicitud.

Los errores excepcionales incluyen también errores de estructura (ej: tags sin cerrar, con nombres incorrectos o en orden incorrecto) y de tipos de datos.

## 1.3.2 Tratamiento de errores en el WS por validaciones de formato

El tratamiento de errores originados por validaciones de formato (definido en los diferentes tipos de datos), para todos los métodos, tendrá el siguiente esquema:

<soapenv:Envelope xmlns:soapenv="[http://schemas.xmlsoap.org/soap/envelope/"](http://schemas.xmlsoap.org/soap/envelope/") xmlns:rem="[http://ar.gob.afip.wsfecred/FECredService/"](http://ar.gob.afip.wsfecred/FECredService/")> <soapenv:Header/> <soapenv:Body> ….. <arrayErroresFormato> <codigoDescripcionString> <codigo>string</codigo> <descripcion>string</descripcion> </codigoDescripcionString> </arrayErroresFormato> ….. </soapenv:Envelope> Dónde:

### <arrayErroresFormato> es del tipo ArrayCodigosDescripcionesStringType que es un

array de <codigoDescripcionString>

### 6 de 88

---

<codigoDescripcionString>
Campo Descripción

| Campo | Descripción |
| --- | --- |
| Código | Código de error |
| descripción | Descripción del error |

Cabe aclarar que, de no superar alguna de las validaciones de formato, el WS devolverá el
arrayErroresFormato y no continuará con las validaciones de negocio, por lo cual no
existirá el elemento arrayErrores. Son excluyentes.

<soapenv:Envelope 
xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
xmlns:rem="http://ar.gob.afip.wsfecred/FECredService/">
<soapenv:Header/>
<soapenv:Body>
…
<arrayErroresFormato>
<codigoDescripcionString>
<codigo>cvc-datatype-valid.1.2.1</codigo>
<descripcion>'?' no es un valor válido para un 
tipo de dato entero.</descripcion>
</codigoDescripcionString>
<codigoDescripcionString>
<codigo>cvc-type.3.1.3</codigo>
<descripcion>El valor '?' en el elemento
' cuitTitularMercaderia' no es
válido.</descripcion>
</codigoDescripcionString>
...
<arrayErroresFormato>
…
</soapenv:Envelope>

1.3.2.1 Aclaración importante: Elemento IdCtaCte

Este servicio opta por utilizar el elemento del standard xsd:choice, para resolver mediante
la validación de formato la elección de una y sólo una manera de identificar una
Cuenta Corriente: mediante su código único en el sistema,  o bien,  mediante la
identificación de la Factura de Crédito que da origen a esa Cuenta Corriente.
La definición del tipo <IdCtaCteType> indica:

La definición del tipo <IdCtaCteType> indica:
<xsd:complexType name="IdCtaCteType">
<xsd:sequence>
<xsd:choice maxOccurs="1" minOccurs="1">
<xsd:element name="codCtaCte" type="xsd:long" maxOccurs="1" 
minOccurs="1"></xsd:element>
<xsd:element name="idFactura" type="tns:IdComprobanteType" 
maxOccurs="1" minOccurs="1"></xsd:element>
</xsd:choice>
</xsd:sequence>
</xsd:complexType>

---

## Tratamiento de errores en el WS por validaciones de formato

Se ha registrado un error común en la invocación del servicio donde se recibe ambos elementos. En estos casos el servicio indica el inconveniente con el siguiente error de formato:

<soapenv:Envelope xmlns:soapenv="[http://schemas.xmlsoap.org/soap/envelope/"](http://schemas.xmlsoap.org/soap/envelope/") xmlns:rem="[http://ar.gob.afip.wsfecred/FECredService/"](http://ar.gob.afip.wsfecred/FECredService/")> <soapenv:Header/> <soapenv:Body> … <arrayErroresFormato> <codigoDescripcionString> **<codigo>cvc-complex-type.2.4.d</codigo>** **<descripcion>Contenido inválido se encontró** **al comienzo del elemento 'idFactura'. No se esperan hijos** **en este punto.</descripcion>** </codigoDescripcionString> </arrayErroresFormato> … </soapenv:Envelope>

La manera correcta de invocación es utilizar sólo un elemento dentro del IdCtaCte, por ejemplo:

Sólo el codCtaCte: <idCtaCte> <codCtaCte>1200</codCtaCte> </idCtaCte>

Sólo el idFactura del tipo IdComprobanteType: <idCtaCte> <idFactura> <CUITEmisor>30999999999</CUITEmisor> <codTipoCmp>201</codTipoCmp> <ptoVta>1</ptoVta> <nroCmp>1</nroCmp> </idFactura> </idCtaCte>

## 8 de 88

---

## Tratamiento de errores en el WS por validaciones de formato

# 1.3.3 Tratamiento de errores por validaciones del negocio.

El tratamiento de errores originados por validaciones del negocio, para todos los métodos, tendrá el siguiente esquema:

<soapenv:Envelope xmlns:soapenv="[http://schemas.xmlsoap.org/soap/envelope/"](http://schemas.xmlsoap.org/soap/envelope/") xmlns:ser=“ [http://ar.gob.afip.wsfecred/FECredService/”](http://ar.gob.afip.wsfecred/FECredService/”)> <soapenv:Header/> <soapenv:Body> … <resultado>string</resultado> <errores> <codigoDescripcion> <codigo>short<codigo> <descripcion>string</descripcion> </codigoDescripcion> </errores> … </soapenv:Body> </soapenv:Envelope>

Dónde:

**<errores> es del tipo ArrayCodigosDescripcionesType** que es un array de **<codigoDescripcion>**

**<codigoDescripcion>**

## Campo Descripción

codigo Código de error descripcion Descripción del error

## 9 de 88

---

1.3.4 Tratamiento de observaciones validaciones del negocio.

Las observaciones tendrán lugar cuando alguna validación del negocio no sea superada y
esta no implique el rechazo de la operación, es decir la misma será aprobada con
observaciones.

<soapenv:Envelope 
xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
xmlns:ser=“ http://ar.gob.afip.wsfecred/FECredService/”>
<soapenv:Header/>
<soapenv:Body>
…
<observaciones>
<codigoDescripcion>
<codigo>short</codigo>
<descripcion>string</descripcion>
</codigoDescripcion>
</observaciones>
…
</soapenv:Body>
</soapenv:Envelope>

Dónde:

<observaciones> es del tipo ArrayCodigosDescripcionesType que es un array de
<codigoDescripcion>

<codigoDescripcion>
Campo Descripción

| Campo | Descripción |
| --- | --- |
| codigo | Código de observación |
| descripcion | Descripción de la observación |

---

1.4 Tratamiento de eventos

Los eventos programados se informarán en respuesta a los diferentes métodos disponibles 
en el presente WS y tendrán el siguiente esquema:

<soapenv:Envelope 
xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser=“ 
http://ar.gob.afip.wsfecred/FECredService/”>
<soapenv:Header/>
<soapenv:Body>
…
<evento>
<codigo>short</codigo>
<descripcion>string</descripcion>
</evento>
…
</soapenv:Body>
</soapenv:Envelope>

Dónde:

<eventos> es del tipo CodigoDescripcionType

| Campo | Descripción |
| --- | --- |
| codigo | Código de evento. Único para un evento dado. |
| descripcion | Detalle del mensaje que se transmite |

---

1.5 Operatoria

El  Web  Service  para  gestionar  las  facturas  de  crédito  electrónica,  permite  a  los
compradores  administrar  las  autorizaciones  de  los  comprobantes  emitidos  por  los
vendedores.

Los perfiles que intervienen en el presente servicio son VENDEDOR y COMPRADOR son:

Vendedor: Es quien emite la Factura Electrónica de Crédito ante la entrega de la
mercadería o servicios. En ese momento se genera la Cuenta Corriente de
esa Factura. El vendedor puede modificar la Cuenta Corriente generando
movimientos  en  la  misma  por  medio  de  notas  de  débito  o  crédito
relacionadas a la Factura original. El vendedor, luego de la aceptación de la
deuda, puede informarla al Agente de Depósito Colectivo (si es la opción de
transferencia elegida)

Comprador:  Es el receptor del producto o servicio. Es el responsable de aceptar o
rechazar las Facturas Electrónicas de Crédito y sus comprobantes asociados.

A partir de cada emisión de una Factura Electrónica de Crédito (FECRED) se creará una
Cuenta Corriente. Hasta tanto no se realice la Aceptación o Rechazo de ésta, se podrán
generar notas de débito y crédito relacionadas con la Factura que modificarán el saldo
negociable.

1.5.1 Estados

A continuación se exhibe un diagrama de estados con los estados por los que pasan los
comprobantes, la cuenta corriente y la relación que existe entre ellos mediante la ejecución
de la operatoria establecida.

• Estados de los Comprobantes: Los comprobantes son la Factura, la Nota de
Débito y la Nota de Crédito.
o En el momento en que son generados, los comprobantes inician en el estado

o En el momento en que son generados, los comprobantes inician en el estado
“Pendiente de Recepción”, y son incorporados en el cálculo del saldo de la
operación en la cuenta corriente.
o Transcurrido el plazo normado tras el envío de la comunicación al domicilio

o Al ser Aceptada la Factura de Crédito, ésta y todos los comprobantes del tipo
Nota  de  Débito  y  Nota  de  Crédito  (que  no  hayan  sido  rechazados
individualmente con anterioridad), pasarán al estado “Aceptado”.
o Al ser Rechazada la Factura de Crédito, ésta y todos los comprobantes del

o Al ser Rechazada la Factura de Crédito, ésta y todos los comprobantes del
tipo Nota de Débito y Nota de Crédito, pasarán al estado “Rechazado”.
o Cuando el vendedor solicita que la Factura sea informada al Agente de

o Cuando el vendedor solicita que la Factura sea informada al Agente de
Depósito Colectivo, la misma, para al estado “Informada”.
o Los comprobantes, Nota de Débito y Nota de Crédito, que son emitidos con

o Los comprobantes, Nota de Débito y Nota de Crédito, que son emitidos con
marca de anulación y/o emitidos con posterioridad a la aceptación o rechazo
de la Factura de Crédito (directa o indirectamente) relacionada, sólo pasan por el estado “Pendiente de Recepción” y luego del plazo establecido a
“Recepcionado”.
Estados de la Cuenta Corriente de una Factura de Crédito Electrónica MiPyme:

• Estados de la Cuenta Corriente de una Factura de Crédito Electrónica MiPyme:
o Al emitirse la Factura se genera su cuenta corriente en estado “Modificable”

o Al emitirse la Factura se genera su cuenta corriente en estado “Modificable”
que permite alterar el saldo de la operación a aceptar o rechazar por el
comprador.
o Si el comprador acepta la operación y no informa cancelación total, la

o Si el comprador acepta la operación y no informa cancelación total, la
cuenta corriente pasa al estado “Aceptada”, con un saldo negociable positivo.
o Si el comprador  acepta la operación e informa cancelación total, la

o Si el comprador  acepta la operación e informa cancelación total, la
cuenta corriente pasa al estado “Cancelada Totalmente”.
o Si el comprador rechaza la operación, la cuenta corriente pasa al estado

o Si el comprador rechaza la operación, la cuenta corriente pasa al estado
“Rechazada”.
o Una  vez  en  estado  “Aceptada”,  el  comprador  puede  informar  la

o Una  vez  en  estado  “Aceptada”,  el  comprador  puede  informar  la
cancelación total o el vendedor puede informar la factura al Agente
de Depósito Colectivo, lo que suceda primero. En estos casos, la cuenta
corriente terminará en el estado  “Cancelada Totalmente”  o  “Informada”,
1
respectivamente. 
Actores y Acciones:

• Actores y Acciones:
o Comprador: El comprador podrá ejecutar las operaciones de:

o Comprador: El comprador podrá ejecutar las operaciones de:
• Aceptar la Factura de Crédito y el saldo de la Cuenta Corriente

• Aceptar la Factura de Crédito y el saldo de la Cuenta Corriente
• Rechazar la Factura de Crédito y el saldo de la Cuenta Corriente

• Rechazar la Factura de Crédito y el saldo de la Cuenta Corriente
• Rechazar individualmente una Nota de Débito o Crédito

• Rechazar individualmente una Nota de Débito o Crédito
• Informar la Cancelación Total del saldo de la Cuenta Corriente de la

• Informar la Cancelación Total del saldo de la Cuenta Corriente de la 
Factura
Vendedor: El vendedor puede ejecutar la siguiente operación:

o Vendedor: El vendedor puede ejecutar la siguiente operación:
• Informar la Factura Aceptada con saldo negociable positivo al Agente

• Informar la Factura Aceptada con saldo negociable positivo al Agente 
de Depósito Colectivo.
Sistema AFIP: Se corren las siguiente operaciones automáticas según los

o Sistema AFIP: Se corren las siguiente operaciones automáticas según los 
plazos normados:
• Se da por “Recepcionado” un comprobante vencido el plazo de

plazos normados:
• Se da por “Recepcionado” un comprobante vencido el plazo de 
notificación normado.
• Se ejecuta la Aceptación Tácita de aquellas Cuentas Corrientes en

notificación normado.
• Se ejecuta la Aceptación Tácita de aquellas Cuentas Corrientes en 
estado “Modificable” vencido el plazo de aceptación normado.

1
 Esta opción sólo puede realizar para las Cuentas Corrientes de Facturas con opción de transferencia 
de Agente de Depósito Colectivo. En cambio, aquellas que hayan sido aceptadas encontrándose con 
opción de transferencia Sistema de Circulación Abierta, quedarán aceptadas sin posibilidad de cambiar 
su estado.

---

FIEF EFIENCIAS:

Tipo,s de Comprobantes::
Tipo A: Factura y Notas de

Tipo,s de Comprobantes::
Tipo A: Factura y Notas de Debito/Ciredito "PRE·APROBACION/RECHAZO" 
Tipo B: Notas de Debito/Credito de Anulacion y Notas de Debito/Credito Post· 
Aprobacion/Recl1azo

Simbologia:

Acto,r,es:
• E: Emisor o Vendedor

{[condicion]}
[accion] ( [actor])
_

Acto,r,es:
• E: Emisor o Vendedor
- R: Receptor o Comprador

- R: Receptor o Comprador
• S: Sistema

- R: Receptor o Comprador
• S: Sistema
Af ec ta a I la o tra

ac c1 0 n so b re u n a En t. da d q u e Af ec ta a I la o tra
- - - --- --- -- - --- -- - - ----- --- -- - ->

---

14

---

## Manejo transaccional

# 1.6 Manejo transaccional

Si no se obtiene respuesta luego de la invocación de un método, puede haber ocurrido un error de comunicación (corte de conexión, timeout, etc.) De ser así puede ocurrir que el request no llegue a los servidores de AFIP o que llegue y se emita una respuesta pero la misma no llegue al cliente. Si se invoca a un método y no se obtiene respuesta, deberá utilizarse los métodos de consultas previstos.

## 15 de 88

---

***Dummy***

# Web Services de Negocio

## 2.1 Direcciones URL

Este servicio se llama en Testing desde: [https://fwshomo.afip.gov.ar/wsfecred/FECredService](https://fwshomo.afip.gov.ar/wsfecred/FECredService)

*Nota: el URL precedente es al cual se conectará la aplicación cliente, no es un URL para ser ingresado en un*

*navegador Web.*

Para visualizar el WSDL en Testing: [https://fwshomo.afip.gov.ar/wsfecred/FECredService?](https://fwshomo.afip.gov.ar/wsfecred/FECredService?) wsdl

Este servicio se llama en Producción desde: [https://serviciosjava.afip.gob.ar/wsfecred/FECredService](https://serviciosjava.afip.gob.ar/wsfecred/FECredService)

*Nota: el URL precedente es al cual se conectará la aplicación cliente, no es un URL para ser ingresado en un*

*navegador Web.*

Para visualizar el WSDL en Producción: [https://serviciosjava.afip.gob.ar/wsfecred/FECredService?wsdl](https://serviciosjava.afip.gob.ar/wsfecred/FECredService?wsdl)

## 2.2 Sitio de consulta y canal de atención

La documentación de este régimen puede consultarse en el micrositio dedicado en [http://www.afip.gob.ar/facturadecreditoelectronica/](http://www.afip.gob.ar/facturadecreditoelectronica/). Para consultas acerca de la arquitectura de Web Services, autenticación y autorización dirigirse a [http://www.afip.gob.ar/ws/](http://www.afip.gob.ar/ws/). Las consultas sobre aspectos técnicos del WS deberán ser remitidas a la cuenta sri@afip.gob.ar. Para su mejor tratamiento, se solicita detallar en el asunto la denominación del WS y ambiente de que se trate (Producción y Homologación), como así también adjuntar request y response. Para consultas propias del negocio o normativas, contactarse mediante el sitio [http://www.afip.gob.ar/consultas](http://www.afip.gob.ar/consultas)

## 2.3 Autenticación

Para utilizar cualquiera de los métodos disponibles en el presente WS se deberá remitir la información obtenida del WS de Autenticación y Autorización (WSAA) resultante del proceso de autenticación, mediante el siguiente esquema:

<soapenv:Envelope xmlns:soapenv="[http://schemas.xmlsoap.org/soap/envelope/"](http://schemas.xmlsoap.org/soap/envelope/") xmlns:ser=“ [http://ar.gob.afip.wsfecred/FECredService/”](http://ar.gob.afip.wsfecred/FECredService/”)> <soapenv:Header/> <soapenv:Body> <...Request> <authRequest>

### 16 de 88

---

<token>string</token>
<sign>string</sign>
<cuitRepresentada>long</cuitRepresentada>
</authRequest>
.
.
.
.
</...Request>
</soapenv:Body>
</soapenv:Envelope>

Dónde:

<authRequest> es del tipo AuthRequestType. Contiene la información referente a la 
autenticación

| Campo / Grupo | Descripción | Obligatorio | Tipo | Longitud |
| --- | --- | --- | --- | --- |
| token | Token devuelto por el WSAA | S | string | -- |
| sign | Signature devuelta por el WSAA | S | string | -- |
| cuitRepresentada | CUIT de la Contribuyente representada o emisora | S | long | 11 |

De no superarse algunas de las situaciones descriptas anteriormente retornará un error del
tipo excepcional.

Recordar que para poder consumir el WSAA es necesario obtener un certificado digital
desde clave fiscal, y asociarlo al ws “Web Service Registro de Facturas de Crédito Electrónica
MiPyMEs ”.
Al momento de solicitar un Ticket de Acceso por medio del WSAA tener en cuenta que debe

Al momento de solicitar un Ticket de Acceso por medio del WSAA tener en cuenta que debe
enviar el tag service con el valor "wsfecred".

Para más información deberá redirigirse a los manuales www.afip.gob.ar/ws.

| Campo / Grupo | Cod error | Mensaje |
| --- | --- | --- |
| cuitRepresentada | 1000 | "LA CUIT NO SE ENCUENTRA ACTIVA EN EL PUC" |
| cuitRepresentada | 1001 | "LA CUIT REGISTRA INCONVENIENTES. DEBERÁ DIRIGIRSE A LA DEPENDENCIA EN LA CUAL SE ENCUENTRA INSCRIPTO" |
| cuitRepresentada | 1002 | "LA CUIT NO REGISTRA ALTA EN IVA o Monotributo o IVA Exento" |
| cuitRepresentada | 1003 | "LA CUIT NO REGISTRA ALTA EN NINGUNA ACTIVIDAD" |
| cuitRepresentada | 1004 | "LA CUIT NO SE ENCUENTRA CON ALTA EN EL DOMICILIO FISCAL ELECTRÓNICO O REGISTRA INCONVENIENTES EN EL MISMO. Sólo puede consultar en este sistema." |

---

2.4 Operaciones

2.4.1 Operaciones a realizar según la RG de aplicación.

Se aplican los siguientes métodos:

• Aceptar Factura Electrónica de Crédito (aceptarFECred)
• Rechazar Factura Electrónica de Crédito (rechazarFECred)

• Rechazar Factura Electrónica de Crédito (rechazarFECred)
• Rechazar Nota de Débito o Crédito (rechazarNotaDC)

• Rechazar Nota de Débito o Crédito (rechazarNotaDC)
• Informar Factura a Agente de Deposito

• Informar Factura a Agente de Deposito
Colectivo (informarFacturaAgtDptoCltv)
• Informar Cancelación Total de la Factura Electrónica de

• Informar Cancelación Total de la Factura Electrónica de
Crédito (informarCancelacionTotalFECred)
• Modificar Opción de Transferencia (modificarOpcionTransferencia)

• Modificar Opción de Transferencia (modificarOpcionTransferencia)
• Consultar Comprobantes (consultarComprobantes)

• Consultar Cuentas Corrientes (consultarCtasCtes)
• Consultar Cuenta Corriente (consultarCtaCte)

• Consultar Comprobantes (consultarComprobantes)
• Consultar Cuentas Corrientes (consultarCtasCtes)

• Consultar Cuenta Corriente (consultarCtaCte)
• Consultar Cuentas Comitente (consultarCuentasComitente) (reemplazado por

• Consultar Cuentas Comitente (consultarCuentasComitente) (reemplazado por
consultarCuentasEnAgtDptoCltv)
• Consultar Cuentas de Emisores FECRED en Agentes de Depósito

• Consultar Cuentas de Emisores FECRED en Agentes de Depósito
Colectivo (consultarCuentasEnAgtDptoCltv)
• Consultar Obligado Recepción (consultarObligadoRecepcion) (deprecado)

• Consultar Obligado Recepción (consultarObligadoRecepcion) (deprecado)
• Consultar Monto Obligado Recepción (consultarMontoObligadoRecepcion)

• Consultar Monto Obligado Recepción (consultarMontoObligadoRecepcion)
• Consultar Tipos de Retenciones (consultarTiposRetenciones)

• Consultar Tipos de Retenciones (consultarTiposRetenciones)
• Consultar Tipos de Motivos de Rechazo (consultarTiposMotivosRechazo)

• Consultar Facturas informadas al Agente de Deposito
Colectivo (consultarFacturasAgtDptoCltv)
• Consultar Tipos de Formas de Cancelacion (consultarTiposFormasCancelacion)

• Consultar Tipos de Formas de Cancelacion (consultarTiposFormasCancelacion)
• Consultar Remitos asociados a un comprobante (obtenerRemitos)

• Consultar Remitos asociados a un comprobante (obtenerRemitos)
• Consultar Historial de Estados de un

• Consultar Historial de Estados de un
Comprobante 
(consultarHistorialEstadosComprobante)

(consultarHistorialEstadosComprobante)
Consultar Historial de Estados de una Cuenta

2.4.2 Validaciones excluyentes

| Campo/Grupo | Cod error | Mensaje |
| --- | --- | --- |
| idCtaCte | 1100 | "Ud no puede operar sobre la cuenta corriente indicada" |
| idCtaCte | 1101 | "Ud no puede realizar esa operación en la cuenta corriente indicada" |
| idCtaCte | 1102 | "No existe la cuenta corriente indicada" |
| genérico | 1103 | "La operación no pudo realizarse, reinténtelo más tarde" |
| idCtaCte | 1104 | "La cuenta corriente fue recientemente modificada, actualice" |
| idComprobante | 1105 | "No existe el comprobante indicado" |
| idCtaCte | 1106 | "Debe aguardar hasta la hora 24 del día siguiente de la fecha de puerta a disposición en DFE para operar con esta cuenta corriente." |
| idCtaCte | 1107 | "Ha excedido el plazo que le permite realizar esta operación." |
| idCtaCte | 1108 | "El estado actual no le permite realizar esta operación." |

• Consultar Historial de Estados de una Cuenta
Corriente (consultarHistorialEstadosCtaCte)
• Consultar Tipos de Ajustes de Operación (consultarTiposAjustesOperacion)

• Consultar Tipos de Ajustes de Operación (consultarTiposAjustesOperacion)
• dummy

• dummy

---

Dummy

| Campo / Grupo | Cod error | Mensaje |
| --- | --- | --- |
| genérico | 10000 | "Error interno de la aplicación" |
| genérico | 32767 | "La búsqueda no ha arrojado resultados con los filtros indicados." |

Ante la recepción de una respuesta detallando error interno recibirá un código [xxxyyyzzzcuitRepresentada-fechaHora-xyz], por favor, indíquelo al informar el error junto con su
request a sri@afip.gob.ar.

---

***Dummy***

**2.4.3 Aceptar Factura Electrónica de Crédito con o sin cancelación parcial o Cancelar totalmente la Factura Electrónica de Crédito**
# (aceptarFECred)

Mediante este método, el comprador (receptor de la Factura) podrá:

## a) Aceptar la Factura de Crédito electrónica, pudiendo además informar la

## cancelación parcial, ajustes, retenciones y/o embargos, de corresponder.

La aceptación de la Factura implica la aceptación de todos aquellos comprobantes asociados que modificaron el saldo de la Cuenta Corriente y no fueron rechazados. Por este mecanismo de interacción Web Service se solicita que se confirme la aceptación o rechazo de cada uno de los comprobantes asociados (ND o NC). También deberá indicarse el saldo resultante negociable. De esta manera el servicio validará el request con todos los registros mantenidos en el sistema. Si la operación es exitosa, la Factura Electrónica de Crédito y su Cta Cte quedan en el estado Aceptadas con el saldo negociable calculado.

Según la opción de transferencia de la Factura al momento de esta operación:

**i)** Opción “Sistema de Circulación Abierta”: El receptor optará por informar un CBU Pagador con las implicancias normadas por este Sistema de Circulación Abierta. En consecuencia, la Factura, con su saldo aceptado, será
## puesta a disposición del Sistema de Circulación Abierta. El comprador

## ya NO podrá informar la cancelación total en este sistema.

**ii)** Opción “Agente de Depósito Colectivo”: **Luego, mientras no se haya** **vencido el plazo de aceptación estipulado, el comprador puede** **informar la cancelación total, mientras el vendedor no haya** **solicitado el informe de la factura al Agente de Depósito Colectivo. A** su vez, una vez aceptada la factura y mientras no haya sido cancelada totalmente, el vendedor tiene la opción de informar al Agente de Depósito Colectivo (la Factura con su saldo negociable).

## b) Cancelar totalmente la Factura de Crédito electrónica. Si se desea informar

una Cancelación Total debe ingresar como importe a cancelar el saldo de la operación (Cuenta Corriente conformada por las FC + ND – NC)), indicando asimismo la forma de cancelación. En caso de cancelación total, no es necesario ingresar importes de retenciones. La cancelación total también conlleva la cancelación de todos los comprobantes (ND y NC) asociados. En caso de que alguna ND o NC no corresponda, se deberá rechazar individualmente. De esta manera el servicio validará el request con todos los registros mantenidos en el sistema. Si la operación es exitosa, la Factura Electrónica de Crédito y su Cta Cte quedan en el estado Canceladas con el saldo negociable en cero (0) y no podrán ser informadas al Agente de Depósito Colectivo. No debe informarse un CBU Pagador para el caso del Sistema de Circulación Abierta.

## 20 de 88

---

***Dummy***

# 2.4.3.1 Mensaje de Solicitud

**Esquema**

21 de 88

---

Donde:
<aceptarFECredRequest> es del tipo <AceptarFECredRequestType>. Contiene la

Donde:
<aceptarFECredRequest> es del tipo <AceptarFECredRequestType>. Contiene la 
información de autenticación y datos para la aceptación de la Cuenta Corriente de la 
FECRED.

| Campo | Descripción | Oblig | Tipo |
| --- | --- | --- | --- |
| authRequest | Contiene información referida a la autenticación | S | AuthRequestType |
| idCtaCte | Identificación de la Cta Cte de la FECRED | S | IdCtaCteType |
| arrayConfirmarNotasDC | Debe reconfirmar si acepta o rechaza cada comprobante (ND/NC) asociado a la Cta Cte para verificar el cálculo del saldo. | N | ArrayConfirmarNotasType |
| arrayFormasCancelacion | De haber cancelado total o parcialmente la FECRED debe indicar una o varias Formas de Cancelación (las formas disponibles se obtienen a través del método consultarTiposFormasCancelacion) | N | ArrayCodigosDescripcionesType |
| arrayRetenciones | Informa las retenciones que aplica al vendedor | N | ArrayRetencionesType |
| arrayAjustesOperacion | Informa los ajustes que deben realizarse al saldo de la operación para el caso de moneda extranjera | N | ArrayAjustesOperacionType |
| tipoCancelacion | De haber cancelado total o parcialmente la FECRED debe indicarlo. | N | TipoCancelacionSimpleType |
| importeCancelado | De haber cancelado, importe cancelado | N | ImporteSimpleType |
| importeTotalRetPesos | Importe Total de Retenciones en PESOS | N | ImporteSimpleType |
| importeEmbargoPesos | De haber aplicado un embargo, el Importe de Embargo en PESOS | N | ImporteSimpleType |
| saldoAceptado | El saldo aceptado | S | ImporteSimpleType |
| codMoneda | Código de Moneda | S | String |
| cotizacionMonedaUlt | Última cotización informada en la Cta.Cte. con la cual se realiza el cálculo del saldo cuando la moneda de la FECRED difiere de PESOS. | S | decimal |
| informaCBU | Obligatorio en cuentas corrientes con la factura con opcionTransferencia“SCA”（no debe enviarse en otro caso). Campo para indicar si enviará la CBU o no | N | SiNoSimpleType |
| CBUComprador | Número de CBU que informa el comprador | N | CBUSimpleType |

2.4.3.2 Mensaje de Respuesta

Esquema

---

Dónde:

<aceptarFECredResponse> es del tipo <OperacionFECredResponseType> que 
contiene el elemento operacionFECredReturn del tipo OperacionFECredReturnType

| Campo | Descripción | Oblig | Tipo |
| --- | --- | --- | --- |
| resultado | Resultado de la aceptación de la Cta.Cte de la FECRED. | S | ResultadoSimpleType |
| idCtaCte | Identificación de Cta.Cte de la FECRED operada | S | IdCtaCteType |
| evento | Contiene, de existir, un anuncio informativo del sistema. | N | CodigoDescripcionType |
| arrayObservaciones | Si la solicitud fue observada, detalla el o los motivos de la observación. | N | ArrayCodigosDescripcionesType |
| arrayErrores | Si la solicitud fue rechazada, detalla el o los motivos que dieron origen al rechazo. | N | ArrayCodigosDescripcionesType |
| arrayErroresFormato | Si el request presenta errores de formato (tags inválidos, sin cerrar, datos que no corresponden al tipo de dato del elemento, etc), en este array se detallan dichos errores | N | ArrayCodigosDescripcionStringType |

| Campo/Grupo | Cod error | Mensaje |
| --- | --- | --- |
| arrayConfirmarNotasDC | 2000 | "Falta informar la aceptación de una Nota de Débito/Crédito" |
| arrayConfirmarNotasDC | 2001 | "Debe rechazar la Nota de Débito/Crédito individualmente si desea rechazarla" |
| arrayConfirmarNotasDC | 2002 | "Informa aceptar una Nota de Débito/Crédito que fue rechazada" |
| arrayRetenciones | 2003 | "Número de jurisdicción de retención inválido o repetido." |
| arrayRetenciones | 2004 | "Debe justificar si modifica el porcentaje de retención normado" |

2.4.3.3 Validaciones excluyentes

Se aplican validaciones pudiendo arrojar los siguientes errores:

---

| Campo / Grupo | Cod error | Mensaje |
| --- | --- | --- |
| arrayRetenciones | 2005 | "El importe retenido no coincide con nuestros cálculos a partir del saldo de la factura de crédito" |
| cotizacionMonedaUlt | 2006 | "Debe indicar una cotizacion al aceptar" |
| cotizacionMonedaUltcodMoneda | 2007 | "La cotizacion para PESOS debe ser 1.0" |
| saldoAceptado | 2008 | "El saldo aceptado informado no coincide con nuestros cálculos a partir del saldo de la factura de crédito" |
| cotizacionMonedaUlt | 2009 | "El tipo de cambio no podra ser inferior al 2% ni superior en un 400% del que suministra AFIP como orientativo de acuerdo a la cotizacion oficial" |
| importeCanceladoimporteTotalRetPesosimporteEmbargoPesos | 2010 | "Informa un importe de negativo, lo que no es válido." |
| cotizacionMonedaUltarrayAjustesOperacion | 2012 | "La cotizacion informada coincide con la de la Factura, no debe informar ajuste por tipo de cambio." |
| arrayAjustesOperacion | 2013 | "Tipo de Ajuste de operación no válido o informado repetido." |
| CUBComprador | 2014 | "No corresponde informar CUB cuando la opción de transferencia no es Sistema de Circulación Abierta." |
| CUBComprador | 2015 | "La CBU no es válida para la CUIT comprador." |
| CUBComprador | 2016 | "No corresponde informar CUB cuando el comprobante quedará cancelado totalmente (el saldo aceptado es 0)." |
| codMonedainformaCBUCUBComprador | 2017 | "No corresponde informar CUB cuando la moneda de la factura es distinta a pesos o dólares" |
| CUBComprador | 2018 | "La moneda de la cuenta de la CBU indicada no coincide con la moneda de la factura" |
| cotizacionMonedaUltcodMoneda | 12000 | "Informa una cotizacion para pesos distinta de 1." |
| codMoneda | 12001 | "Informa una moneda distinta a la de la Factura de Crédito." |
| saldoAceptado | 12002 | "El saldo aceptado que informa no coincide por el calculado por nuestros registros, verifique sus cuentas." |
| arrayConfirmarNotasDC | 12003 | "Falta indicar su informe de confirmación de aceptación de al menos una Nota de Debito/Crédito de la cuenta corriente que se encuentran registras" |
| arrayConfirmarNotasDC | 12004 | "No coincide su informe de confirmación de aceptación de las Nota de Debito/Crédito de la cuenta corriente con el estado en el cual se encuentran registras" |
| arrayRetencionesimporteTotalRetPesos | 12005 | "Tiene diferencias entre el total y los parciales de los importes de retenciones informadas" |
| arrayRetenciones | 12006 | "Al informar un percentaje de retención distinto a lo normado, debe informar una justificación." |
| arrayRetencionesimporteTotalRetPesos | 12007 | "La información de retenciones está incompleta. De informar retenciones debe informar importe mayor a 0 y al menos una retención" |
| arrayFormasCancelaciontipoCancelacionimporteCancelado | 12008 | "La información de cancelación está incompleta. De informar cancelación debe informar importe mayor a 0, al menos una forma de cancelación y el tipo (si es parcial o total)" |
| arrayRetenciones | 12009 | "El código de la retención es inválido(consultarTiposRetenciones)." |
| arrayAjustesOperacion | 12010 | "Sólo puede informar ajustes de operación para moneda extranjera." |
| informaCBU | 12012 | "No debe informar CBU Comprador con Cancelación Total." |
| informaCBU CBUComprador | 12013 | "Si indica que informa CBU debe enviarla y viceversa." |
| informaCBU | 12014 | "Debe indicar si desea informar la CBU comprador al aceptar una factura con opcion de transferencia de Sistema de Circulacion Abierta" |
| informaCBU | 12015 | "No debe indicar si desea informar la CBU comprador al aceptar una factura con opcion de transferencia distinta de Sistema de Circulacion Abierta" |
| importeCancelado tipoCancelacion | 4000 | "El monto informado no cancela totalmente el saldo de la FECRED" |
| arrayFormasCancelacion | 4001 | "Falta informar al menos una forma de cancelación" |
| arrayFormasCancelacion | 4002 | "Código de forma de cancelación inválido o repetido." |
| arrayFormasCancelacion | 4003 | "Las formas de cancelación "Cesión" y "Locación de Bienes Inmuebles" deben ser usadas para cancelación total y sin informar otro tipo de forma de cancelación entre los usados" |

2.4.3.4 Observaciones

Se aplican validaciones pudiendo arrojar las siguientes observaciones:

| Campo / Grupo | Cod error | Mensaje |
| --- | --- | --- |
| CBUComprador | 9000 | "La CBU no pudo validarse."2 |

2
 La CBU es validada online con los sistemas habilitados por el BCRA. En caso de existir algún 
inconveniente sistémico, esta operación de aceptación será aceptada y se notificará al contribuyente 
con este mensaje. A posterior, el contribuyente deberá informar la CBU mediante los sistemas que 
habilite el Sistema de Circulación Abierta oportunamente.

---

2.4.4 Rechazar Factura Electrónica de Crédito (rechazarFECred)

Mediante este método, el Comprador, dentro del plazo estipulado para el rechazo, puede
Rechazar la Cta. Cte. de una Factura Electrónica de Crédito debiendo indicar el motivo del
rechazo.
De esta manera la Factura y su Cta. Cte asociada alcanzarán el estado final Rechazadas

De esta manera la Factura y su Cta. Cte asociada alcanzarán el estado final Rechazadas
quedando la imposibilidad al vendedor de informarla al Agente de Depósito Colectivo.

2.4.4.1 Mensaje de Solicitud

Esquema

<rechazarFECredRequest> es del tipo RechazarFECredRequestType. Contiene los 
datos necesarios para indicar el rechazo.

| Campo / Grupo | Descripción | Obligatorio | Tipo |
| --- | --- | --- | --- |
| authRequest | Contiene información referente a la autenticación | S | AuthRequestType |
| idCtaCte | Identificación de la Cta Cte de la FECRED | S | IdCtaCteType |
| arrayMotivosRechazo | Arreglo donde indica y justifica al menos un motivo de rechazo | S | ArrayMotivosRechazoType |

2.4.4.2 Mensaje de Respuesta

Esquema:

---

Dónde:

<rechazarFECredResponse> es del tipo <OperacionFECredResponseType> que 
contiene el elemento operacionFECredReturn del tipo OperacionFECredReturnType

| Campo | Descripción | Oblig | Tipo |
| --- | --- | --- | --- |
| resultado | Resultado del rechazo de la Cta.Cte de la FECRED. | S | ResultadoSimpleType |
| idCtaCte | Identificación de Cta.Cte de la FECRED operada | S | IdCtaCteType |
| evento | Contiene, de existir, un anuncio informativo del sistema. | N | CodigoDescripcionType |
| arrayObservaciones | Si la solicitud fue observada, detalla el o los motivos de la observación. | N | ArrayCodigosDescripcionesType |
| arrayErrores | Si la solicitud fue rechazada, detalla el o los motivos que dieron origen al rechazo. | N | ArrayCodigosDescripcionesType |
| arrayErroresFormato | Si el request presenta errores de formato (tags inválidos, sin cerrar, datos que no corresponden al tipo de dato del elemento, etc), en este array se detallan dichos errores | N | ArrayCodigosDescripcionStringType |

1.1.1.1 Validaciones excluyentes
Se aplican validaciones pudiendo arrojar los siguientes errores:

| Campo / Grupo | Cod error | Mensaje |
| --- | --- | --- |
| descMotivo | 3000 | "Debe indicar una justificación por el rechazo" |
| codMotivo | 3001 | "Código de motivo de rechazo inválido o repetido." |

---

2.4.5 Rechazar Nota de Débito o Crédito (rechazarNotaDC)

Método que permite al Comprador rechazar Notas de Débito / Crédito individualmente
mientras la Factura de Crédito no haya sido Aceptada o Rechazada. Al rechazarla no
afectará a la Cta Cte. Debe indicar al menos un motivo de rechazo y justificarlo.

2.4.5.1 Mensaje de Solicitud

Esquema

Dónde:

< rechazarNotaDCRequest> es del tipo RechazarNotaDCRequestType. Contiene los 
datos necesarios para rechazar un comprobante del tipo Nota de Débito o Crédito.

| Campo / Grupo | Descripción | Obligatorio | Tipo |
| --- | --- | --- | --- |
| authRequest | Contiene información referente a la autenticación | S | AuthRequestType |
| idComprobante | Identificador único del comprobante. Compuesto por Cuit, punto de venta, tipo de comprobante y número | S | IdComprobanteType |
| arrayMotivosRechazo | Arreglo donde indica y justifica al menos un motivo de rechazo | S | ArrayMotivosRechazoType |

2.4.5.2 Mensaje de Respuesta

---

| RechazarNotaDCResponseType |
| --- |
| rechazarNotaDCReturn [1..1] RechazarNotaDCReturnType |
| RechazarNotaDCReturnType |
| idComprobante [0..1] IdComprobanteType |
| resultado [1..1] ResultadoSimpleType |
| evento [0..1] CodigoDescripcionType |
| arrayObservaciones [0..1] ArrayCodigosDescripcionesType |
| arrayErrores [0..1] ArrayCodigosDescripcionesType |
| arrayErroresFormato [0..1] ArrayCodigosDescripcionesStringType |

Donde:
< rechazarNotaDCResponse> es del tipo RechazarNotaDCResponseType que

< rechazarNotaDCResponse> es del tipo RechazarNotaDCResponseType que 
contiene el resultado de la solicitud < rechazarNotaDCReturn> del tipo 
RechazarNotaDCReturnType

| Campo | Descripción | Oblig | Tipo |
| --- | --- | --- | --- |
| idComprobante | Identificación del comprobante solicitado | S | IdComprobanteType |
| resultado | Resultado de la operación.A: Aprobado,O: Observado,R: Rechazado | S | ResultadoSimpleType |
| evento | Contiene, de existir, un anuncio informativo del sistema. | N | CodigoDescripcionType |
| arrayObservaciones | Si la solicitud fue observada, detalla el o los motivos de la observación. | N | ArrayCodigosDescripcionesType |
| arrayErrores | Si la solicitud fue rechazada, detalla el o los motivos que dieron origen al rechazo. | N | ArrayCodigosDescripcionesType |
| arrayErroresFormato | Si el request presenta errores de formato(tags inválidos,sin cerrar,datos que no corresponden al tipo de dato del elemento,etc),en este array se detallan dichos errores | N | ArrayCodigosDescripcionStringType |

1.1.1.1 Validaciones excluyentes

| Campo / Grupo | Cod error | Mensaje |
| --- | --- | --- |
| Resultado de la operación | 5000 | "El rechazo de esta nota no puede realizarse, deja el saldo de la operación inválido (cero o negativo)" |
| idComprobante | 15000 | "Ud no puede realizar esa operación en el comprobante en el estado en el que se encuentra" |
| arrayMotivosRechazo | 3000 | "Debe indicar una justificación por el rechazo" |
| arrayMotivosRechazo | 3001 | "Código de motivo de rechazo inválido o repetido." |

---

2.4.6 Informar Factura a Agente de Deposito Colectivo
(informarFacturaAgtDptoCltv)

Para aquellas Facturas con opción de transferencia “Agente de Depósito Colectivo”, es
mediante este método que el sistema permite al Vendedor informar a un Agente de
Depósito Colectivo la factura de crédito con el saldo negociable resultante de la cuenta
corriente vinculada aceptada por el comprador, debiendo indicar una de sus cuentas
abiertas en algún Agente de Depósito Colectivo informadas por estos a la AFIP. Esas
cuentas las puede consultar mediante la operación consultarCuentasEnAgtDptoCltv.

2.4.6.1 Mensaje de Solicitud

Esquema

<informarFacturaAgtDptoCltvRequest> es del tipo 
InformarFacturaAgtDptoCltvRequestType. Contiene los datos necesarios informar la 
Factura a un Agente de Depósito Colectivo.

| Campo/Grupo | Descripción | Obligatorio | Tipo |
| --- | --- | --- | --- |
| authRequest | Contiene información referente a la autenticación | S | AuthRequestType |
| idCtaCte | Identificación de la Cta Cte de la FECRED | S | IdCtaCteType |
| ctaAgente | Cuenta en un Agente de Depósito Colectivo a la cual vincula el informe de la Factura | S | CuentaEnAgenteType |

2.4.6.2 Mensaje de Respuesta

Esquema:

---

< informarFacturaAgtDptoCltvResponse> es del tipo
<OperacionFECredResponseType> que contiene el elemento operacionFECredReturn 
del tipo OperacionFECredReturnType

| Campo | Descripción | Oblig | Tipo |
| --- | --- | --- | --- |
| resultado | Resultado de la operación sobre la Cta.Cte de la FECRED. | S | ResultadoSimpleType |
| idCtaCte | Identificación de Cta.Cte de la FECRED operada | S | IdCtaCteType |
| evento | Contiene, de existir, un anuncio informativo del sistema. | N | CodigoDescripcionType |
| arrayObservaciones | Si la solicitud fue observada, detalla el o los motivos de la observación. | N | ArrayCodigosDescripcionesType |
| arrayErrores | Si la solicitud fue rechazada, detalla el o los motivos que dieron origen al rechazo. | N | ArrayCodigosDescripcionesType |
| arrayErroresFormato | Si el request presenta errores de formato (tags inválidos, sin cerrar, datos que no corresponden al tipo de dato del elemento, etc), en este array se detallan dichos errores | N | ArrayCodigosDescripcionStringType |

2.4.6.3 Validaciones excluyentes

Se aplican validaciones pudiendo arrojar los siguientes errores:
Cod

| Campo / Grupo | Cod error | Mensaje |
| --- | --- | --- |
| idCtaCte | 6000 | "La factura ya fue informada al agente de depósito colectivo" |
| idCtaCte | 6001 | "La factura ya fue informada al agente de depósito colectivo y se encuentra pendiente de confirmación de recepción" |
| ctaAgente | 6002 | "Los datos de la cuenta en el agente no son válidos para la CUIT representada" |
| Error de sistema | 6003 | "Problema con método de envío al agente de depósito colectivo" |
| idCtaCte | 6004 | "Esta factura de crédito no constituye un “título ejecutivo y valor no cartular” por la fecha de vencimiento de pago con la cual fue emitida (Ley 27440-Art 4)" |
| idCtaCte | 6005 | "Debe aguardar al fin del plazo de aceptación para poder solicitar el informe al agente de depósito colectivo, por la fecha de vencimiento de pago con la cual fue emitida (Ley 27440-Art 4 inc. d -2do párrafo)" |
| idCtaCte | 6006 | "Debe aguardar a que se cumpla la fecha de vencimiento de pago para solicitar el informe a caja de valores (Ley 27.400-Art 18)" |
| idCtaCte |  | "La factura se encuentra a la espera de la lectura del agente de |

---

2.4.7 Informar Cancelación Total de la Factura Electrónica de
Crédito (informarCancelacionTotalFECred)

Método por el cual el Comprador, dentro los plazos establecidos,  habiendo aceptado
previamente la FECRED, informa que ha cancelado (pagado) totalmente la deuda al
vendedor, debiendo indicar la forma de cancelación".
En caso que la cancelación total se haya informado con el método ‘ aceptarFECred’  (punto

En caso que la cancelación total se haya informado con el método ‘ aceptarFECred’  (punto
2.4.3), NO debe informarse en este método.
Este método no es válido para aquella facturas aceptadas con opción de transferencia

Este método no es válido para aquella facturas aceptadas con opción de transferencia
“Sistema de Circulación Abierta”

2.4.7.1 Mensaje de Solicitud

Esquema

<informarCancelacionTotalFECredRequest> es del tipo 
InformarCancelacionTotalFECredRequestType. Contiene los datos necesarios informar 
la cancelación de la Factura Electrónica de Crédito.

| Campo / Grupo | Descripción | Oblig | Tipo |
| --- | --- | --- | --- |
| authRequest | Contiene información referente a la autenticación | S | AuthRequestType |
| idCtaCte | Identificación de la Cta Cte de la FECRED | S | IdCtaCteType |
| arrayFormasCancelacion | Debe indicar una o varias Formas de Cancelación (las formas disponibles se obtienen a través del método consultarTiposFormasCancelacion) | S | ArrayCodigos DescripcionesType |
| importeCancelacion | Importe cancelado | S | Importe SimpleType |

2.4.7.2 Mensaje de Respuesta

Esquema:

---

<informarCancelacionTotalFECredResponse> es del tipo
<OperacionFECredResponseType> que contiene el elemento operacionFECredReturn 
del tipo OperacionFECredReturnType

| Campo | Descripción | Oblig | Tipo |
| --- | --- | --- | --- |
| resultado | Resultado de la operación sobre la Cta.Cte de la FECRED. | S | ResultadoSimpleType |
| idCtaCte | Identificación de Cta.Cte de la FECRED operada | S | IdCtaCteType |
| evento | Contiene, de existir, un anuncio informativo del sistema. | N | CodigoDescripcionType |
| arrayObservaciones | Si la solicitud fue observada, detalla el o los motivos de la observación. | N | ArrayCodigosDescripcionesType |
| arrayErrores | Si la solicitud fue rechazada, detalla el o los motivos que dieron origen al rechazo. | N | ArrayCodigosDescripcionesType |
| arrayErroresFormato | Si el request presenta errores de formato(tags inválidos,sin cerrar,datos que no corresponden al tipo de dato del elemento,etc),en este array se detallan dichos errores | N | ArrayCodigosDescripcionStringType |

2.4.7.3 Validaciones excluyentes

| Campo / Grupo | Cod error | Mensaje |
| --- | --- | --- |
| importeCancelacion | 4000 | "El monto informado no cancela totalmente el saldo de la FECRED" |
| arrayFormasCancelacion | 4001 | "Falta informar al menos una forma de cancelación" |
| arrayFormasCancelacion | 4002 | "Código de forma de cancelación inválido o repetido." |

---

2.4.8 Modificar opción de transferencia (modificarOpcionTransferencia)

Método que permite al emisor o vendedor modificar la opción de transferencia de una
Factura de Crédito previo a la aceptación o rechazo de la misma, es decir el estado de la
cuenta corriente debe ser “Modificable”.
Las opciones de transferencia que pueden seleccionarse son:

Las opciones de transferencia que pueden seleccionarse son:
-Agentes de Depósito Colectivo (ADC)

-Agentes de Depósito Colectivo (ADC)
-Sistema de Circulación Abierta (SCA)

-Sistema de Circulación Abierta (SCA)

2.4.8.1 Mensaje de Solicitud

Esquema

<modificarOpcionTransferenciaRequest> es del tipo 
ModificarOpcionTransferenciaRequestType. Contiene los datos necesarios solicitar el 
cambio de opción de transferencia de la Factura Electrónica de Crédito.

| Campo / Grupo | Descripción | Oblig | Tipo |
| --- | --- | --- | --- |
| authRequest | Contiene información referente a la autenticación | S | AuthRequestType |
| idCtaCte | Identificación de la Cta Cte de la FECRED | S | IdCtaCteType |
| opcionTransferencia | Indica la opción de transferencia elegida | S | OpcionTransferenciaSimpleType |

2.4.8.2 Mensaje de Respuesta

Esquema:

Dónde:

<modificarOpcionTransferenciaResponse> es del tipo
<OperacionFECredResponseType> que contiene el elemento operacionFECredReturn 
del tipo OperacionFECredReturnType

---

| Campo | Descripción | Oblig | Tipo |
| --- | --- | --- | --- |
| resultado | Resultado de la operación sobre la Cta.Cte de la FECRED. | S | ResultadoSimpleType |
| idCtaCte | Identificación de Cta.Cte de la FECRED operada | S | IdCtaCteType |
| evento | Contiene, de existir, un anuncio informativo del sistema. | N | CodigoDescripcionType |
| arrayObservaciones | Si la solicitud fue observada, detalla el o los motivos de la observación. | N | ArrayCodigosDescripcionesType |
| arrayErrores | Si la solicitud fue rechazada, detalla el o los motivos que dieron origen al rechazo. | N | ArrayCodigosDescripcionesType |
| arrayErroresFormato | Si el request presenta errores de formato (tags inválidos, sin cerrar, datos que no corresponden al tipo de dato del elemento, etc), en este array se detallan dichos errores | N | ArrayCodigosDescripcionStringType |

2.4.8.3 Validaciones excluyentes

Se aplican validaciones pudiendo arrojar los siguientes errores:

| Campo / Grupo | Cod error | Mensaje |
| --- | --- | --- |
| opcionTransferencia | 7000 | "Indica la misma opción de transferencia ya elegida" |

---

***Dummy***

# 2.4.9 Consultar Comprobantes (consultarComprobantes)

Método que permite obtener información sobre los comprobantes Emitidos y Recibidos. Debe indicar el rol de la CUIT Representada, Emisor o Receptor. Además tiene la posibilidad de indicar filtros por la CUIT de la contraparte, el tipo de comprobante, el estado del comprobante (Pendiente de Recepción, Recepcionado, Aceptado o Rechazado), un filtro de fechas, la cuenta corriente a la que se relacionan, y el estado de la cuenta corriente a la cual se relacionan (Modificable, Aceptada, Rechazada, Cancelada Totalmente o Informada al Agente de Depósito Colectivo).

A partir de la versión 1.3.0 del sistema se agrega la posibilidad de que la solicitud pueda incluir el número de página que se requiere de manera secuencial y así optimizar los tiempos de respuesta de este servicio. Por ejemplo, podrá solicitar el número de página 1, 2, 3, etc., manteniendo los mismos filtros entre los consecutivos request hasta que el servicio le responda que “NO hay mas” comprobantes. El tamaño de página será manejado por el servicio de manera dinámica.

## 2.4.9.1 Mensaje de Solicitud

**Esquema**

### 36 de 88

---

<consultarComprobantesRequest> es del tipo ConsultarComprobanteRequestType.
Contiene los datos necesarios para consultar los comprobantes.

| Campo / Grupo | Descripción | Obligat orio | Tipo |
| --- | --- | --- | --- |
| authRequest | Contiene información referente a la autenticación | S | AuthRequestType |
| rolCUITRepresentada | Deberá indicar la condición de "Emisor" o "Receptor" en los comprobantes que desea buscar para la&lt;cuitRepresentada&gt;(obtenida del elemento&lt;authRequest&gt;). | S | RolSimpleType |
| CUITContraparte | Cuit de la contraparte. Si en&lt;rolCUITRepresentada&gt;indicó Emisor, podrá filtrar por los receptores. Si en&lt;rolCUITRepresentada&gt;indicó Receptor, podrá filtrar por los emisores. | N | CuitSimpleType |
| codTipoCmp | Código del Tipo de comprobante | N | short |
| estadoCmp | Estado del comprobante | N | EstadoCmpSimpleType |
| fecha | Fecha sobre la que se va a hacer la consulta y el rango solicitado | N | FiltroFechaType |
| codCtaCte | Código de la Cuenta Corriente sobre la cual se quieren ver los comprobantes.Si ingresa un valor buscará sólo los comprobantes de esa cuenta corriente.Si ingresa el valor 0 la búsqueda no arrojará resultados | N | long |
| estadoCtaCte | Estado de la cuenta corriente a consultar | N | EstadoCtaCteSimpleType |
| nroPagina | (Opcional) Numero de página solicitada. | N | short |

---

Dummy

| Campo | Descripción | Oblig | Tipo |
| --- | --- | --- | --- |
| arrayComprobantes | Listado de Comprobantes que coinciden con los filtros de búsqueda | N | ArrayComprobantesType |
| nroPagina | Número de página solicitado al que pertenecen los comprobantes del elemento anterior | N | short |
| hayMas | Indicador si hay más comprobantes en páginas subsiguientes | N | SiNoSimpleType |
| evento | Contiene, de existir, un anuncio informativo del sistema. | N | CodigoDescripcionType |
| arrayObservaciones | Si la solicitud fue observada, detalla el o los motivos de la observación. | N | ArrayCodigosDescripcionesType |
| arrayErrores | Si la solicitud fue rechazada, detalla el o los motivos que dieron origen al rechazo. | N | ArrayCodigosDescripcionesType |
| arrayErroresFormato | Si el request presenta errores de formato (tags inválidos, sin cerrar, datos que no corresponden al tipo de dato del elemento, etc), en este array se detallan dichos errores | N | ArrayCodigosDescripcionStringType |

2.4.9.3 Observaciones

En caso de no encontrar resultados con los datos indicados arrojará en el 
arrayObservaciones:

| Campo / Grupo | Cod error | Mensaje |
| --- | --- | --- |
| arrayObservaciones | 32767 | "La búsqueda no ha arrojado resultados con los filtros indicados" |

2.4.9.4 Validaciones excluyentes

| Campo / Grupo | Cod error | Mensaje |
| --- | --- | --- |
| nroPagina | 12011 | "El número de página solicitado debe ser mayor a cero." |

---

2.4.10 Consultar Cuentas Corrientes (consultarCtasCtes)

Método que permite obtener las cuentas corrientes que fueron generadas a partir de la
facturación, que coinciden con los parámetros de búsqueda.

A partir de la versión 1.3.0 del sistema se agrega la posibilidad de que la solicitud pueda
incluir el número de página que se requiere de manera secuencial y así optimizar los
tiempos de respuesta de este servicio. Por ejemplo, podrá solicitar el número de página 1,
2, 3, etc., manteniendo los mismos filtros entre los consecutivos request hasta que el
servicio le responda que  “NO hay mas”  comprobantes. El tamaño de página será
manejado por el servicio de manera dinámica.

2.4.10.1 Mensaje de Solicitud

Esquema

| ConsultarCitasCtesRequestType |
| --- |
| authRequest [1..1] AuthRequestType |
| rolCUITRepresentada [1..1] RolSimpleType |
| CUITContraparte [0..1] CuitSimpleType |
| fecha [0..1] FiltroFechaType |
| estadoCtaCte [0..1] EstadoCtaCteSimpleType |
| nroPagina [0..1] short |
| opcionTransferencia [0..1] OpcionTransferenciaSimpleType |

| ConsultarCitasCtesRequestType |  |
| --- | --- |
| authRequest | [1..1] AuthRequestType |
| rolCUITRepresentada | [1..1] RolSimpleType |
| CUITContraparte | [0..1] CuitSimpleType |
| fecha | [0..1] FiltroFechaType |
| estadoCtaCte | [0..1] EstadoCtaCteSimpleType |
| nroPagina | [0..1] short |
| opcionTransferencia | [0..1] OpcionTransferenciaSimpleType |

<consultarCtasCtesRequest> es del tipo ConsultarCtasCtesRequestType.

Dónde:

| FiltroFechaType |  |  |
| --- | --- | --- |
| tipo | [1..1] | TipoFechaSimpleType |
| desde | [1..1] | date |
| hasta | [1..1] | date |

| Campo / Grupo | Descripción | Oblig | Tipo |
| --- | --- | --- | --- |
| authRequest | Contiene información referente a la autenticación | S | AuthRequestType |
| rolCUITRepresentada | Deberá indicar la condición de "Emisor" o "Receptor" en los cuentas corrientes que desea buscar para la&lt;cuitRepresentada&gt;(obtenida del | S | RolSimpleType |

---

| Campo / Grupo | Descripción | Oblig | Tipo |
| --- | --- | --- | --- |
|  | elemento&lt;authRequest&gt;). |  |  |
| CUITContraparte | Cuit de la contraparte, que ocupa el rol opuesto(Emisor o Receptor) a la selección del camporolCUITRepresentada | N | CuitSimpleType |
| fecha | Campo que permite determinar sobre qué fecha vamos a hacer el filtro | N | FiltroFechaType |
| estadoCtaCte | Campo que representa el estado de las cuentas corrientes a consultar en el caso de ser informado | N | EstadoCtaCteSimpleType |
| nroPagina | (Opcional) Numero de página solicitada. | N | short |
| opcionTransferencia | Campo para filtrar por la opción de transferencia vigente de la factura de crédito de la cuenta corriente | N | OpcionTransferenciaSimpleType |

2.4.10.2 Mensaje de Respuesta

Esquema

| consultarCtasCtesResponse | ConsultarCtasCtesResponseType |
| --- | --- |
| consultarCtasCtesReturn[1..1] ConsultarCtasCtesReturnType |  |

Dónde:

<consultarCtasCtesResponse> es del tipo ConsultarCtasCtesResponseType que 
contiene el listado resultante de las cuentas identificadas <consultarCtasCtesReturn> 
del tipo ConsultarCtasCtesReturnType

| Campo | Descripción | Oblig | Tipo |
| --- | --- | --- | --- |
| arrayInfosCtaCte | Listado con la información resumida de las cuentas corrientes identificadas según los parámetros de búsqueda | N | ArrayInfosCtaCteType |
| nroPagina | Número de página solicitado al que pertenecen los comprobantes del elemento anterior | N | short |
| hayMas | Indicador si hay más comprobantes en páginas subsiguientes | N | SiNoSimpleType |
| evento | Contiene, de existir, los anuncios informativos del sistema. | N | CodigoDescripcionType |
| arrayObservaciones | Observaciones a exteriorizar sobre los parámetros de entrada o sobre validaciones funcionales al momento de hacer la búsqueda | N | ArrayCodigos DescripcionesType |
| arrayErrores | Errores funcionales que rechazan la búsqueda | N | ArrayCodigos DescripcionesType |

---

Dummy

| Campo | Descripción | Oblig | Tipo |
| --- | --- | --- | --- |
| arrayErroresFormato | Si el request presenta errores de formato (tags inválidos, sin cerrar, datos que no corresponden al tipo de dato del elemento, etc), en este array se detallan dichos errores | N | ArrayCodigos DescripcionStringType |

2.4.10.3 Observaciones

En caso de no encontrar resultados con los datos indicados arrojará en el 
arrayObservaciones:

| Campo / Grupo | Cod error | Mensaje |
| --- | --- | --- |
| arrayObservaciones | 32767 | "La búsqueda no ha arrojado resultados con los filtros indicados" |

2.4.10.4 Validaciones excluyentes

Se aplican validaciones pudiendo arrojar los siguientes errores:

| Campo / Grupo | Cod error | Mensaje |
| --- | --- | --- |
| nroPagina | 12011 | "El número de página solicitado debe ser mayor a cero." |

---

2.4.11 Consultar Cuenta Corriente (consultarCtaCte)

Método que permite obtener el detalle y composición de una Cuenta Corriente de una 
Factura Electrónica de Crédito.

2.4.11.1 Mensaje de Solicitud

Esquema

Dónde:

<consultarCtaCteRequest> es del tipo ConsultarCtaCteRequestType. Contiene los 
datos necesarios para consultar los datos de una cuenta corriente.

| Campo / Grupo | Descripción | Oblig | Tipo |
| --- | --- | --- | --- |
| authRequest | Contiene información referente a la autenticación | S | AuthRequestType |
| idCtaCte | Identificación de la Cta Cte de la FECRED | S | IdCtaCteType |

2.4.11.2 Mensaje de Respuesta

<consultarCtaCteResponse> es del tipo ConsultarCtaCteResponseType que contiene
el elemento consultarCtaCteReturn del tipo <ConsultarCtaCteReturnType>

---

| Campo | Descripción | Oblig | Tipo |
| --- | --- | --- | --- |
| ctaCte | Todo el detalle de la Cuenta Corriente solicitada | N | CuentaCorrienteType |
| evento | Contiene, de existir, los anuncios informativos del sistema. | N | CodigoDescripcionType |
| arrayObservaciones | Observaciones a exteriorizar sobre los parámetros de entrada o sobre validaciones funcionales al momento de hacer la búsqueda | N | ArrayCodigos DescripcionesType |
| arrayErrores | Errores funcionales que rechazan la búsqueda | N | ArrayCodigos DescripcionesType |
| arrayErroresFormato | Si el request presenta errores de formato (tags inválidos, sin cerrar, datos que no corresponden al tipo de dato del elemento, etc), en este array se detallan dichos errores | N | ArrayCodigos DescripcionStringType |

---

2.4.12 Consultar Cuentas En Agentes de Depósito 
Colectivo (consultarCuentasEnAgtDptoCltv)

Método que permite al Vendedor consultar sus Cuentas en Agentes de Depósito Colectivo 
que fueron informadas por ellos a la AFIP.

2.4.12.1 Mensaje de Solicitud

Dónde:

<consultarCuentasEnAgtDptoCltvRequest> es del tipo 
ConsultarCuentasEnAgtDptoCltvRequestType. Contiene los datos necesarios para la 
consulta.
Campo / Grupo Descripción Oblig. Tipo

| &lt;consultarCuentasEnAgtDptoCltvRequest&gt; es del tipoConsultarCuentasEnAgtDptoCltvRequestType. Contiene los datos necesarios para la consulta. |  |  |  |
| --- | --- | --- | --- |
| Campo / Grupo | Descripción | Oblig. | Tipo |
| authRequest | Contiene información referente a la autenticación | S | AuthRequestType |

2.4.12.2 Mensaje de Respuesta

Esquema

Dónde:

<consultarCuentasEnAgtDptoCltvResponse> es del tipo 
ConsultarCuentasEnAgtDptoCltvResponseType que contiene un elemento 
consultarCuentasEnAgtDptoCltvReturn del tipo 
ConsultarCuentasEnAgtDptoCltvReturnType

| Campo | Descripción | Oblig | Tipo |
| --- | --- | --- | --- |
| arrayCuentasEnAgente | Listado de cuentas | S | ArrayCuentasEnAgenteType |
| arrayObservaciones | Observaciones a exteriorizar sobre los parámetros de entrada o sobre validaciones funcionales al momento de hacer la búsqueda | N | ArrayCodigosDescripcionesType |
| arrayErrores | Errores funcionales | N | ArrayCodigosDescripcionesType |
| arrayErroresFormato | Si el request presenta errores de formato (tags inválidos, sin cerrar, datos que no corresponden al tipo de dato del elemento, etc), en este array se detallan dichos errores | N | ArrayCodigosDescripcionesStringType |

---

2.4.12.3 Observaciones

En caso de no encontrar resultados con los datos indicados arrojará en el 
arrayObservaciones:

| Campo / Grupo | Cod error | Mensaje |
| --- | --- | --- |
| arrayObservaciones | 32767 | "La búsqueda no ha arrojado resultados con los filtros indicados" |

---

2.4.13 Consultar Obligado Recepción (consultarObligadoRecepción)

Método que permite conocer si la CUIT consultada se encuentra obligada a recibir una 
Factura Electrónica de Crédito.

DEPRECADO:

La información suministrada por este método es incompleta. La obligación 
corresponde a partir de determinado monto de factura que está en función de la 
actividad principal del contribuyente y de la fecha de emisión del comprobante. 
Utilice la operación consultarMontoObligadoRecepción

2.4.13.1 Mensaje de Solicitud

Esquema

| Campo / Grupo | Descripción | Oblig | Tipo |
| --- | --- | --- | --- |
| authRequest | Contiene información referente a la autenticación | S | AuthRequestType |
| cuitConsultada | Cuit consultada | S | CuitSimpleType |

2.4.13.2 Mensaje de Respuesta

Esquema

Dónde:
<consultarObligadoRecepciónResponse> es del tipo

| Campo | Descripción | Oblig | Tipo |
| --- | --- | --- | --- |
| respuesta | Indica si está obligado | N | SiNoSimpleType |
| desde | Fecha a partir de la cual está obligado | N | date |
| arrayObservacion | Observaciones a exteriorizar sobre los parámetros de entrada o sobre validaciones funcionales al momento de hacer la búsqueda | N | ArrayCodigos DescripcionesType |
| arrayErrores | Errores funcionales según los parámetros de entrada | N | ArrayCodigos DescripcionesType |
| arrayErroresFormato | Si el request presenta errores de formato (tags inválidos, sin cerrar, | N | ArrayCodigos DescripcionesStringTy |

---

Dummy

| Campo | Descripción | Oblig | Tipo |
| --- | --- | --- | --- |
|  | datos que no corresponden al tipo de dato del elemento, etc), en este array se detallan dichos errores |  | pe |

---

2.4.14 Consultar Tipos de Retenciones (consultarTiposRetenciones)

Método que permite consultar los tipos de retenciones habilitadas con sus respectivos 
porcentajes.

2.4.14.1 Mensaje de Solicitud

Esquema

<consultarTiposRetencionesRequest> es del tipo 
ConsultarCodigoDescripcionRequestType. Contiene los datos necesarios para la 
consulta.

| Campo / Grupo | Descripción | Oblig | Tipo |
| --- | --- | --- | --- |
| authRequest | Contiene información referente a la autenticación | S | AuthRequestType |

2.4.14.2 Mensaje de Respuesta

Esquema

| ConsultarTiposRetencionesResponseType |
| --- |
| consultarTiposRetencionesReturn [1..1] ConsultarTiposRetencionesReturnType |
| ConsultarTiposRetencionesReturnType |
| arrayTiposRetenciones [0..1] ArrayTiposRetencionesType
arrayErroresFormato [0..1] ArrayCodigosDescripcionesStringType |

Dónde:

<consultarTiposRetencionesResponse> es del tipo 
ConsultarTiposRetencionesResponseType que contiene un elemento 
consultarTiposRetencionesReturn del tipo ConsultarTiposRetencionesReturnType

| Campo | Descripción | Oblig | Tipo |
| --- | --- | --- | --- |
| arrayTiposRetenciones | Arreglo con los Tipos de Retenciones habilitados en el sistema | N | ArrayTiposRetencionesType |
| arrayErroresFormato | Si el request presenta errores de formato (tags inválidos, sin cerrar, datos que no corresponden al tipo de dato del elemento, etc), en este array se detallan dichos errores | N | ArrayCodigosDescripcionesStringType |

---

2.4.15 Consultar Tipos de Motivos de Rechazo
(consultarTiposMotivosRechazo)

(consultarTiposMotivosRechazo)

Método que permite listar los tipos de motivos de rechazo habilitados para una Factura 
Electrónica de Crédito y su Cuenta Corriente vinculada.

2.4.15.1 Mensaje de Solicitud

Esquema

Dónde:
<consultarTiposMotivosRechazoRequest> es del tipo

<consultarTiposMotivosRechazoRequest> es del tipo 
ConsultarCodigoDescripcionRequestType. Contiene los datos necesarios para la 
consulta.

| Campo / Grupo | Descripción | Oblig | Tipo |
| --- | --- | --- | --- |
| authRequest | Contiene información referente a la autenticación | S | AuthRequestType |

2.4.15.2 Mensaje de Respuesta

Esquema

Dónde:
<consultarTiposMotivosRechazoResponse> es del tipo

<consultarTiposMotivosRechazoResponse> es del tipo 
ConsultarCodigoDescripcionResponseType que contiene un elemento 
codigoDescripcionReturn del tipo ConsultarCodigoDescripcionReturnType

| Campo | Descripción | Oblig | Tipo |
| --- | --- | --- | --- |
| arrayCodigoDescripcion | Contiene los datos correspondientes a los tipos de motivos de rechazo. | N | ArrayCodigos DescripcionesType |
| arrayErroresFormato | Si el request presenta errores de formato (tags inválidos, sin cerrar, datos que no corresponden al tipo de dato del elemento, etc), en este array se detallan dichos errores | N | ArrayCodigos DescripcionesStringType |

---

2.4.16 Consultar Facturas informadas al Agente de 
Deposito Colectivo (consultarFacturasAgtDptoCltv)

Método que permite obtener información sobre los facturas informadas al Agente de
Depósito Colectivo. Permite obtener si el Agente ha recibido efectivamente el informe,
dicho de otra manera, exterioriza el acuse de recibo del Agente. Puede realizar una
consulta particular identificando la Cuenta Corriente o Factura, o una consulta por rango de
fechas utilizando el filtro disponible.

2.4.16.1 Mensaje de Solicitud

Esquema

Dónde:

<consultarFacturasAgtDptoCltvRequest> es del tipo 
ConsultarFacturasAgtDptoCltvRequestType. Contiene los datos necesarios para la 
consulta.

| Campo / Grupo | Descripción | Oblig | Tipo |
| --- | --- | --- | --- |
| authRequest | Contiene información referente a la autenticación | S | AuthRequestType |
| idCtaCte | Identificación de la Cta Cte de la FECRED | N | IdCtaCteType |
| filtroFecha | Fecha sobre la que se va a hacer la consulta y el rango solicitado | N | FiltroFechaType |

2.4.16.2 Mensaje de Respuesta

< consultarFacturasAgtDptoCltvResponse> es del tipo 
ConsultarFacturasAgtDptoCltvResponseType que contiene un elemento 
consultarFacturasAgtDptoCltvReturn del tipo 
ConsultarFacturasAgtDptoCltvReturnType

| Campo | Descripción | Oblig | Tipo |
| --- | --- | --- | --- |
| arrayFacturasAgtDptoCltv | Arreglo con las facturas que coinciden con los parámetros de búsqueda | N | ArrayFacturasAgtDptoCltvType |
| evento | Contiene, de existir, un anuncio informativo del sistema. | N | CodigoDescripcionType |
| arrayObservacion | Observaciones a exteriorizar | N | ArrayCodigos |

Dónde:

---

Dummy

| Campo | Descripción | Oblig | Tipo |
| --- | --- | --- | --- |
|  | sobre los parámetros de entrada o sobre validaciones funcionales al momento de hacer la búsqueda |  | DescripcionesType |
| arrayErrores | Errores funcionales según los parámetros de entrada | N | ArrayCodigos DescripcionesType |
| arrayErroresFormato | Si el request presenta errores de formato (tags inválidos, sin cerrar, datos que no corresponden al tipo de dato del elemento, etc), en este array se detallan dichos errores | N | ArrayCodigos DescripcionesStringType |

2.4.16.3 Observaciones

En caso de no encontrar resultados con los datos indicados arrojará en el 
arrayObservaciones:

| Campo / Grupo | Cod error | Mensaje |
| --- | --- | --- |
| arrayObservaciones | 32767 | "La búsqueda no ha arrojado resultados con los filtros indicados" |

---

2.4.17 Consultar Tipos de Formas de 
Cancelación 
(consultarTiposFormasCancelacion)

Método que permite listar los tipos de formas de cancelación habilitados para una Factura 
Electrónica de Crédito.

2.4.17.1 Mensaje de Solicitud

Esquema

Dónde:

<consultarTiposFormasCancelacionRequest> es del tipo 
ConsultarCodigoDescripcionRequestType. Contiene los datos necesarios para la 
consulta.

| Campo / Grupo | Descripción | Oblig | Tipo |
| --- | --- | --- | --- |
| authRequest | Contiene información referente a la autenticación | S | AuthRequestType |

2.4.17.2 Mensaje de Respuesta

Dónde:

<consultarTiposFormasCancelacionResponse> es del tipo 
ConsultarCodigoDescripcionResponseType que contiene un elemento 
codigoDescripcionReturn del tipo ConsultarCodigoDescripcionReturnType

| Campo | Descripción | Oblig | Tipo |
| --- | --- | --- | --- |
| arrayCodigoDescripcion | Contiene los códigos y descripciones correspondientes a las formas de cancelación habilitados. | N | ArrayCodigos DescripcionesType |
| arrayErroresFormato | Si el request presenta errores de formato (tags inválidos, sin cerrar, datos que no corresponden al tipo de dato del elemento, etc), en este array se detallan dichos errores | N | ArrayCodigos DescripcionesStringType |

---

2.4.18 Obtener Remitos asociados a un Comprobante
(obtenerRemitos)

Permite obtener los remitos asociados a un comprobante en su emisión.

2.4.18.1 Mensaje de Solicitud

Esquema

<obtenerRemitosRequest> es del tipo ObtenerRemitosRequestType. Contiene los 
datos necesarios para la consulta.

| Campo / Grupo | Descripción | Oblig | Tipo |
| --- | --- | --- | --- |
| authRequest | Contiene información referente a la autenticación | S | AuthRequestType |
| idComprobante | Identificación del comprobante del cual se quieren consultar sus remitos asociados | S | IdComprobanteType |

1.1.1.1 Mensaje de Respuesta

<obtenerRemitosResponse> es del tipo ObtenerRemitosResponseType que contiene 
un elemento obtenerRemitosReturn del tipo ObtenerRemitosReturnType

| Campo | Descripción | Oblig | Tipo |
| --- | --- | --- | --- |
| arrayIdsRemitos | Arreglo con los identificadores de los remitos asociados en el comprobante consultado | N | ArrayIdsComprobantes |
| arrayErrores | Contiene los códigos y descripciones correspondientes a los errores de negocio detectados. | N | ArrayCodigos DescripcionesType |

---

Dummy

| Campo | Descripción | Oblig | Tipo |
| --- | --- | --- | --- |
| arrayErroresFormato | Si el request presenta errores de formato (tags inválidos, sin cerrar, datos que no corresponden al tipo de dato del elemento, etc), en este array se detallan dichos errores | N | ArrayCodigos DescripcionesStringType |

---

2.4.19 Consultar Historial de Estados de un Comprobante
(consultarHistorialEstadosComprobante)

Permite obtener el historial con los cambios de estado de un comprobante.

2.4.19.1 Mensaje de Solicitud

Esquema

Dónde:
<consultarHistorialEstadosComprobanteRequest> es del tipo

<consultarHistorialEstadosComprobanteRequest> es del tipo 
ConsultarHistorialEstadosComprobanteType. Contiene los datos necesarios para la 
consulta.

| Campo / Grupo | Descripción | Oblig | Tipo |
| --- | --- | --- | --- |
| authRequest | Contiene información referente a la autenticación | S | AuthRequestType |
| idComprobante | Identificación del comprobante del cual se quieren consultar. | S | IdComprobanteType |

1.1.1.2 Mensaje de Respuesta

Esquema

| ConsultarHistorialEstadosComprobanteReturnType |  |
| --- | --- |
| idComprobante | [1..1] IdComprobanteType |
| arrayHistorialEstados | [1..1] ArrayHistorialEstadosComprobanteType |
| arrayErrores | [0..1] ArrayCodigosDescripcionesType |
| arrayErroresFormato | [0..1] ArrayCodigosDescripcionesStringType |

| &lt;consultarHistorialEstadosComprobanteResponse&gt;es del tipo |
| --- |
| ConsultarHistorialEstadosComprobanteResponseTypeque contiene un elemento consultarHistorialEstadosComprobanteReturn del tipo |
| ConsultarHistorialEstadosComprobanteReturnType |

Dónde:
<consultarHistorialEstadosComprobanteResponse> es del tipo

---

Dummy

| Campo | Descripción | Oblig | Tipo |
| --- | --- | --- | --- |
| idComprobante | Identificación del comprobante del cual se quieren consultar sus remitos asociados | S | IdComprobanteType |
| arrayHistorialEstados | Arreglo con los estados por los cuales pasó el comprobante | S | ArrayHistorialEstadosComprobanteType |
| arrayErrores | Contiene los códigos y descripciones correspondientes a los errores de negocio detectados. | N | ArrayCodigosDescripcionesType |
| arrayErroresFormato | Si el request presenta errores de formato (tags inválidos, sin cerrar, datos que no corresponden al tipo de dato del elemento, etc), en este array se detallan dichos errores | N | ArrayCodigosDescripcionesStringType |

---

2.4.20 Consultar Historial de Estados de una Cuenta Corriente
(consultarHistorialEstadosCtaCte)

Permite obtener el historial con los cambios de estado de una cuenta corriente.

2.4.20.1 Mensaje de Solicitud

Esquema

<consultarHistorialEstadosCtaCteRequest> es del tipo
ConsultarHistorialEstadosCtaCteType. Contiene los datos necesarios para la consulta.

| Campo / Grupo | Descripción | Oblig | Tipo |
| --- | --- | --- | --- |
| authRequest | Contiene información referente a la autenticación | S | AuthRequestType |
| idCtaCte | Identificación de la cuenta corriente del cual se quiere consultar. | S | IdCtaCteType |

1.1.1.3 Mensaje de Respuesta

Esquema

consultarHistoricalEstadosCtaCteResponse consultarHistoricalEstadosCtaCteResponseType
consultarHistoricalEstadosCtaCteReturn [1..1] consultarHistoricalEstadosCtaCteReturnType

| consultarHistorialEstadosCtaCteReturnType |  |
| --- | --- |
| e idCtaCte | [1..1] IdCtaCteType |
| e arrayHistorialEstados | [1..1] ArrayHistorialEstadosCtaCteType |
| e arrayErrores | [0..1] ArrayCodigosDescripcionesType |
| e arrayErroresFormato | [0..1] ArrayCodigosDescripcionesStringType |

Dónde:
<consultarHistorialEstadosCtaCteResponse> es del tipo

| Campo | Descripción | Oblig | Tipo |
| --- | --- | --- | --- |
| idCtaCte | Identificación de la cuenta corriente del cual se quiere consultar. | S | IdCtaCteType |
| arrayHistorialEstados | Arreglo con los estados por los cuales pasó la cuenta corriente | S | ArrayHistorialEstadosCtaCteType |
| arrayErrores | Contiene los códigos y descripciones correspondientes a los errores de negocio detectados. | N | ArrayCodigosDescripcionesType |
| arrayErroresFormato | Si el request presenta errores de formato (tags inválidos, sin cerrar,datos que no corresponden al tipo de dato del elemento,etc), en este array se detallan dichos errores | N | ArrayCodigosDescripcionesStringType |

---

2.4.21 Consultar Tipos de Ajustes de Operación
(consultarTiposAjustesOperacion)

(consultarTiposAjustesOperacion)

Método que permite listar los tipos de ajustes disponibles al momento de informar la 
aceptación de una Factura Electrónica de Crédito y su Cuenta Corriente vinculada.

2.4.21.1 Mensaje de Solicitud

Dónde:

<consultarTiposAjustesOperacionRequest> es del tipo 
ConsultarCodigoDescripcionRequestType. Contiene los datos necesarios para la 
consulta.

| Campo / Grupo | Descripción | Oblig | Tipo |
| --- | --- | --- | --- |
| authRequest | Contiene información referente a la autenticación | S | AuthRequestType |

2.4.21.2 Mensaje de Respuesta

Dónde:
<consultarTiposAjustesOperacionResponse> es del tipo

<consultarTiposAjustesOperacionResponse> es del tipo 
ConsultarCodigoDescripcionResponseType que contiene un elemento 
codigoDescripcionReturn del tipo ConsultarCodigoDescripcionReturnType

| Campo | Descripción | Oblig | Tipo |
| --- | --- | --- | --- |
| arrayCodigoDescripcion | Contiene los datos correspondientes a los tipos ajustes a la operación disponibles. | N | ArrayCodigos DescripcionesType |
| arrayErroresFormato | Si el request presenta errores de formato (tags inválidos, sin cerrar, datos que no corresponden al tipo de dato del elemento, etc), en este array se detallan dichos errores | N | ArrayCodigos DescripcionesStringType |

---

2.4.22 Consultar Monto Obligado 
Recepción

Recepción 
(consultarMontoObligadoRecepción)

Método que permite conocer si la CUIT consultada se encuentra obligada a recibir una
Factura Electrónica de Crédito para una determinada fecha de emisión del comprobante
indicando el monto umbral a partir del cual debe confeccionarse una Factura Electrónica de
Crédito en lugar de una Factura o Recibo Electrónico del Régimen General.

2.4.22.1 Mensaje de Solicitud

Esquema

<consultarMontoObligadoRecepcionRequest> es del tipo 
consultarMontoObligadoRecepcionRequestType. Contiene los datos necesarios para la 
consulta.
Campo / Grupo Descripción Oblig Tipo

| Campo / Grupo | Descripción | Oblig | Tipo |
| --- | --- | --- | --- |
| authRequest | Contiene información referente a la autenticación | S | AuthRequestType |
| cuitConsultada | Cuit consultada | S | CuitSimpleType |
| fechaEmision | Fecha en la cual se quiere emitir el comprobante | S | date |

2.4.22.2 Mensaje de Respuesta

consultarMontoObligadoRecepcionResponse ConsultarMontoObligadoRecepcionResponseType
consultarMontoObligadoRecepcionReturn [1..1] ConsultarMontoObligadoRecepcionReturnType

Dónde:

<consultarMontoObligadoRecepcionResponse> es del tipo 
consultarMontoObligadoRecepcionResponseType que contiene un elemento 
consultarMontoObligadosRecepcionReturn del tipo 
ConsultarMontoObligadoRecepcionReturnType
Campo Descripción Oblig Tipo

| Campo | Descripción | Oblig | Tipo |
| --- | --- | --- | --- |
| respuesta | Indica si está obligado | N | SiNoSimpleType |
| montoDesde | Importe de factura a partir del cual está obligado a recibir Factura de Crédito Electrónica (inclusive) | N | ImporteSimpleType |
| arrayObservacion | Observaciones a exteriorizar sobre los parámetros de entrada o sobre validaciones funcionales al momento de hacer la búsqueda | N | ArrayCodigos DescripcionesType |
| arrayErrores | Errores funcionales según los parámetros de entrada | N | ArrayCodigos DescripcionesType |
| arrayErroresFormato | Si el request presenta errores de formato(tags inválidos,sin cerrar,datos que no corresponden al tipo de | N | ArrayCodigos DescripcionesStringTy |

---

Dummy

| Campo | Descripción | Oblig | Tipo |
| --- | --- | --- | --- |
|  | dato del elemento, etc), en este array se detallan dichos errores |  | pe |

---

2.4.23 Dummy

Permite verificar el funcionamiento del presente WS.

2.4.23.1 Mensaje de Solicitud

Esquema
<soapenv:Envelope

<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
<soapenv:Header/>
<soapenv:Body/>
</soapenv:Envelope>

2.4.23.2 Mensaje de Respuesta

Retorna el resultado de la verificación de los elementos principales de infraestructura del 
servicio.

Esquema

<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
xmlns:tab="http://ar.gob.afip.wsfecred/FECredService/">
<soapenv:Header/>
<soapenv:Body>
<tab:dummyResponse>
<return>
<appserver>?</appserver>
<authserver>?</authserver>
<dbserver>?</dbserver>
</return>
</tab:dummyResponse>
</soapenv:Body>
</soapenv:Envelope>

<dummyResponse> detalla el resultado de la validación, contiene los siguientes campos:

Dónde:

| Campo/Grupo | Detalle | Obligatorio | Tipo |
| --- | --- | --- | --- |
| appserver | Servidor de aplicaciones | S | string |
| authserver | Servidor de base de datos | S | string |
| dbserver | Servidor de autenticacion | S | string |

<dummyResponse>
Campo/Grupo

---

***Dummy***

# 2.4.23.3 Ejemplo para “Dummy”

<soapenv:Envelope xmlns:soapenv="[http://schemas.xmlsoap.org/soap/envelope/"](http://schemas.xmlsoap.org/soap/envelope/")> <soapenv:Header/> <soapenv:Body/> </soapenv:Envelope>

<soapenv:Envelope xmlns:soapenv="[http://schemas.xmlsoap.org/soap/envelope/"](http://schemas.xmlsoap.org/soap/envelope/") xmlns:ser="[http://ar.gob.afip.wsfecred/FECredService/"](http://ar.gob.afip.wsfecred/FECredService/")> <soapenv:Header/> <soapenv:Body> <ser:dummyResponse> <appserver>OK</appserver> <authserver>OK</authserver> <dbserver>OK</dbserver> </ser:dummyResponse> </soapenv:Body> </soapenv:Envelope>

## 62 de 88

---

3 Definición de tipos de datos

3.1 Simple Types

| Type | Tipo de dato primitivo | Restricción |
| --- | --- | --- |
| CBUSimpleType | string | Numérico de 22 caracteres |
| PorcentajeSimpleType | decimal | Porcentaje = 0.00 &lt; P&lt; 100.00 |
| RolSimpleType | string | Emisor Receptor |
| TipoFechaSimpleType | String | Emision= Fecha de EmisiónPuestaDispo= Fecha puerta a DisposiciónVenPago= Fecha vencimiento de pagoVenAcep= Fecha vencimiento aceptaciónAcep= Fecha aceptaciónInfoAgDptoCtv= Fecha informada a Agente de Deposito |
| EstadoCtaCteSimpleType | String | ModificableAceptadaRechazadaCanceladaTotalInformadaAgDpto= Informada al Agente de Deposito |
| EstadoCmpSimpleType | String | PendienteRecepcionRecepcionadoAceptadoRechazadoInformadaAgDpto= Informada al Agente de Deposito |
| ImporteSimpleType | decimal | Total de digitos 15(13 enteros y 2 decimales).Valor mínimo permitido-999999999999.99Valor máximo permitido999999999999.99 |
| PuntoVentaSimpleType | int | Valor mínimo1Valor máximo99999 |
| NumeroComprobanteSimpleType | long | Valor mínimo1Valor máximo9999999 |
| TipoCodAutorizacionType | String | A= CAEAE= CAE |
| TipoAceptacionSimpleType | String | TacitaExpresa |
| TipoCancelacion | String | PAR=ParcialTOT=Total |
| CuitSimpleType | long | Longitud 11. |
| DecimalSimpleType | decimal | Total de digitos 18(12 enteros y 6 decimales)0&lt;d&lt;999999999999.999999 |
| NumeroSimpleType | long | Puede tomar los valores comprendidos en el intervalo desde 1 hasta 99999999 |
| ResultadoSimpleType | string | A: Aprobado,O: Observado,R: Rechazado |
| SiNoSimpleType | string | S= SiN= No |
| Texto250SimpleType | string | Texto hasta 250 caracteres. |
| OpcionTransferenciaSimpleType | string | ADC= Agentes de Depósito ColectivoSCA= Sistema de Circulación Abierta |

---

3.2 Complex Type

ArrayCodigosDescripcionesType es un array de elementos codigoDescripcion del tipo
CodigoDescripcionType

| ArrayCodigosDescripcionesType |
| --- |
| codigoDescripcion [1..*] CodigoDescripcionType |
| codigo [1..1] short
descripcion [1..1] string |

CodigoDescripcionType.

| Campo / Grupo | Descripción | Obligatorio | Tipo | Longitud |
| --- | --- | --- | --- | --- |
| Código | Indentificador del tipo que representa | S | short | -- |
| Descripción | Descripción del código | S | string | -- |

ArrayCodigosDescripcionesStringType es un array de elementos 
codigoDescripcionString del tipo CodigoDescripcionStringType

| ArrayCodigosDescripcionesStringType |  |
| --- | --- |
| e codigoDescripcionString [1..*] CodigoDescripcionStringType |  |

| CodigoDescripcionStringType |  |  |
| --- | --- | --- |
| codigo | [1..1] | string |
| descripcion | [1..1] | string |

CodigoDescripcionStringType.

| Campo / Grupo | Descripción | Obligatorio | Tipo | Longitud |
| --- | --- | --- | --- | --- |
| Código | Indentificador del tipo que representa | S | string | -- |
| Descripción | Descripción del código | S | string | -- |

AuthRequestType. Contiene la información referente a la autenticación

| AuthRequestType |  |
| --- | --- |
| token | [1..1] string |
| sign | [1..1] string |
| cuitRepresentada | [1..1] CuitSimpleType |

CuitSimpleType

| Campo / Grupo | Descripción | Obligatorio | Tipo | Longitud |
| --- | --- | --- | --- | --- |
| token | Token devuelto por el WSAA | S | string | -- |
| sign | Signature devuelta por el WSAA | S | string | -- |
| cuitRepresentada | CUIT del Contribuyente representado | S | CuitSimpleType | 11 |

---

ArrayCuentasEnAgenteType es un array de elementos del tipo CuentaEnAgenteType

| CuentaEnAgenteType |  |
| --- | --- |
| cuitAgente | [1..1] CuitSimpleType |
| razonSocialAgente | [0..1] string |
| idCuenta | [1..1] IdCuentaAgenteSimpleType |
| denominacion | [0..1] Texto250SimpleType |

CuentaEnAgenteType

| CuentaEnAgenteType |  |
| --- | --- |
| cuitAgente | [1..1] CuitSimpleType |
| razonSocialAgente | [0..1] string |
| idCuenta | [1..1] IdCuentaAgenteSimpleType |
| denominacion | [0..1] Texto250SimpleType |

| Campo/Grupo | Descripción | Oblig | Tipo |
| --- | --- | --- | --- |
| cuitAgente | Cuit del Agente de Depósito Colectivo en el cual se encuentra la cuenta | S | int |
| razonSocialAgente | El sistema envía la razón social del Agente de Depósito Colectivo | N | string |
| idCuenta | Identificador de la cuenta provisto por el Agente de Depósito Colectivo | S | int |
| denominacion | Denominación de la cuenta (usada como dato de salida de este sistema) | N | Texto250SimpleType |

FiltroFechaType

| FiltroFechaType |  |  |
| --- | --- | --- |
| tipo | [1..1] | TipoFechaSimpleType |
| desde | [1..1] | date |
| hasta | [1..1] | date |

| Campo/Grupo | Descripción | Oblig | Tipo |
| --- | --- | --- | --- |
| Tipo | Tipo de Fecha | S | TipoFechaSimpleType |
| desde | Fecha Desde | S | date |
| Hasta | Fecha Hasta | S | date |

---

ArrayInfosCtaCteType es un array del tipo InfoCtaCteType

| ArrayInfosCtaCteType |  |
| --- | --- |
| infoCtaCte | [1..*] InfoCtaCteType |

| InfoCtaCteType |  |  |
| --- | --- | --- |
| codCtaCte | [1..1] | long |
| estadoCtaCte | [1..1] | EstadoCtaCteSimpleType |
| idFacturaCredito | [1..1] | IdComprobanteType |
| importeTotalFC | [1..1] | ImporteSimpleType |
| saldo | [1..1] | ImporteSimpleType |
| saldoAceptado | [0..1] | ImporteSimpleType |

InfoCtaCteType

| InfoCtaCteType |  |
| --- | --- |
| codCtaCte | [1..1] long |
| estadoCtaCte | [1..1] EstadoCtaCteType |
| idFacturaCredito | [1..1] IdComprobanteType |
| importeTotalFC | [1..1] ImporteSimpleType |
| saldo | [1..1] ImporteSimpleType |
| saldoAceptado | [0..1] ImporteSimpleType |
| codMoneda | [1..1] string |
| opcionTransferencia | [1..1] OpcionTransferenciaSimpleType |

OpcionTransferenciaSimpleType

ImporteSimpleType

| Campo/Grupo | Descripción | Oblig | Tipo |
| --- | --- | --- | --- |
| codCtaCte | Codigo identificador de la cuenta corriente. Campo necesario para consultas puntuales sobre la cuenta corriente mediante el método consultarCtaCte (en singular) | S | long |
| estadoCtaCte | Estado actual de la cuenta corriente | S | EstadoCtaCteSimpleType |
| idFacturaCredito | Identificador único del comprobante autorizado que forma parte de la cuenta corriente | S | IdComprobanteType |
| importeTotalFC | Importe total de la factura de crédito | S | ImporteSimpleType |
| saldo | Saldo actual | S | ImporteSimpleType |
| saldoAceptado | Saldo aceptado (si fue aceptada) | N | ImporteSimpleType |
| codMoneda | Código de Moneda de la factura de crédito | S | string |
| opcionTransferencia | Opción de transferencia vigente de la factura de crédito de la cuenta corriente | S | OpcionTransferenciaSimpleType |

---

ArrayIdsComprobantesType es un array del tipo IdComprobanteType

| ArrayIdsComprobantesType |  |
| --- | --- |
| idsComprobantes [1..*] | IdComprobanteType |

| IdComprobanteType |  |
| --- | --- |
| e CUITEmisor | [1..1] CuitSimpleType |
| e codTipoCmp | [1..1] short |
| e ptoVta | [1..1] PuntoVentaSimpleType |
| e nroCmp | [1..1] NumeroComprobanteSimpleType |

IdComprobanteType

| IdComprobanteType |  |
| --- | --- |
| CUITEmisor | [1..1] CuitSimpleType |
| codTipoCmp | [1..1] short |
| ptoVta | [1..1] PuntoVentaSimpleType |
| nroCmp | [1..1] NumeroComprobanteSimpleType |

| Campo/Grupo | Descripción | Obliq | Tipo |
| --- | --- | --- | --- |
| CUITEmisor | Cuit emisor del comprobante | S | CuitSimpleType |
| codTipoCmp | Tipo de Comprobante | S | short |
| ptoVta | Punto de venta | S | PuntoVentaSimpleType |
| nroCmp | Número de Comprobante | S | NumeroComprobanteSimpleType |

IdCtaCteType

| IdComprobanteType |  |
| --- | --- |
| CUITEmisor | [1..1] CuitSimpleType |
| codTipoCmp | [1..1] short |
| ptoVta | [1..1] PuntoVentaSimpleType |
| nroCmp | [1..1] NumeroComprobanteSimpleType |

Contiene un CHOICE que debe contener uno y sólo uno de:

| Campo/Grupo | Descripción | Oblig | Tipo |
| --- | --- | --- | --- |
| codCtaCte | Código único asignado por este sistema a una Cta Cte de una FECRED | choice | long |
| idFactura | Id de la Factura que dio origen a esa Cta Cte | choice | IdComprobanteType |

---

***Abreviaturas***

## ArrayComprobantesType es un array del tipo ComprobanteType

68 de 88

---

***Abreviaturas***

**ComprobanteType**

**Obli** **Campo/Grupo Descripción Tipo** **g** Cuit emisor del cuitEmisor S CuitSimpleType comprobante

69 de 88

---

| razonSocialEmi | Tipo de Comprobante | S | string |
| --- | --- | --- | --- |
| codTipoCmp | Número de Comprobante | S | short |
| ptovta | Punto de venta | S | PuntoVentaSimpleType |
| nroCmp | Número de comprobante | S | NumeroComprobanteSimpleType |
| cuitReceptor | Cuit del receptor del comprobante | S | CuitSimpleType |
| razonSocialRecep | Razón Social del Receptor del comprobante | S | String |
| tipoCodAuto | Modalidad de autorización,método CAE o CAEA | S | TipoCodAutorizacionType |
| codAutorizacion | Código de Autorización Electrónica | S | Long |
| fechaEmision | Fecha de emisión del comprobante | S | date |
| fechaPuestaDispo | Fecha en la que se puso a disposición en el sistema de gestión. | N | date |
| fechaVenPago | Fecha de vencimiento de Pago | N | date |
| fechaVenAcep | Fecha de vencimiento de Aceptación | N | date |
| importeTotal | Importe total del comprobante | S | ImporteSimpleType |
| codMoneda | Código de Moneda | S | String |
| cotizacionMoneda | Cotizacion de la Moneda | S | decimal |
| CBUEmisor | CBU de la cuenta del Emisor | N | CBUSimpleType |
| AliasEmisor | Alias de la CBU informada por el emisor | N | Texto250SimpleType |
| esAnulacion | Si es una nota de crédito o débito,indica si este comprobante es de anulación | N | SiNoSimpleType |
| esPostAceptacion | Si es una nota de crédito o débito,indica si este comprobante fue emitido luego de la aceptación/rechazo de la factura de crédito asociada | N | SiNoSimpleType |
| idComprobanteAsociado | Si es una nota de crédito o débito,indica el identificador del comprobante asociado | N | IdComprobanteType |
| referenciasCommerciales | Campos de texto libre completado por el emisor en la emisión | N | ArrayTexto250SimpleType |
| arraySubtotalesIVA | Arreglo con los subtotales de IVA del | N | ArraySubtotalesIVAType |

---

|  | comprobante |  |  |
| --- | --- | --- | --- |
| arrayOtrosTributos | Arreglo con los otros tributos del comprobante | N | ArrayOtrosTributosType |
| arrayItems | Arreglo con el detalle de items del comprobante para aquellos emitidos por Comprobantes en Linea y el Webservice de Codificación de Productos | N | ArrayItemsType |
| datosGenerales | Datos generales ingresados por el emisor del comprobante | N | string |
| datosComerciales | Datos comerciales ingresados por el emisor del comprobante | N | string |
| leyendaComercial | Leyenda comercial ingresada por el emisor del comprobante | N | Texto250SimpleType |
| codCtaCte | Codigo de la Cuenta Corriente que integra este comprobante | S | long |
| estado | Estado del Comprobante | S | EstadoCmpType |
| tipoAcep | Tipo de aceptación, tacita o expresa | N | TipoAceptacionSimpleType |
| fechaHoraAcep | Fecha y hora de la aceptación o rechazo | N | dateTime |
| arrayMotivosRechazo | Si fue rechazado, los motivos informados | N | ArrayMotivosRechazoType |
| opciónTransferencia | Para las Facturas, la opción de transferencia seleccionada | S | OpcionTransferenciaSimpleType |
| infoTransferencia | Información según la opción de transferencia seleccionada y el estado de la factura y la transferencia al sistema correspondiente | N | InfoTransferenciaType |

---

CuentaCorrienteType

| CuentaCorrienteType |  |
| --- | --- |
| codCtaCte | [1..1] long |
| estadoCtaCte | [1..1] EstadoCtaCteType |
| factura | [1..1] ComprobanteType |
| arrayNotasDCAsociadas | [0..1] ArrayComprobantesType |
| arrayFormasCancelacion | [0..1] ArrayCodigosDescripcionesType |
| arrayRetenciones | [0..1] ArrayRetencionesType |
| arrayAjustesOperacion | [0..1] ArrayAjustesOperacionType |
| importeInicial | [1..1] ImporteSimpleType |
| importeTotalNotasDC | [0..1] ImporteSimpleType |
| importeCancelado | [0..1] ImporteSimpleType |
| importeTotalRetPesos | [0..1] ImporteSimpleType |
| importeEmbargoPesos | [0..1] ImporteSimpleType |
| saldoAceptado | [0..1] ImporteSimpleType |
| saldo | [1..1] ImporteSimpleType |
| codMoneda | [1..1] string |
| cotizacionMonedaUlt | [1..1] decimal |

| Campo/Grupo | Descripción | Oblig | Tipo |
| --- | --- | --- | --- |
| codCtaCte | Código de la Cta.Cte | S | long |
| estadoCtaCte | Estado de la Cta.Cte | S | EstadoCtaCteType |
| fechaHoraEstado | Fecha y hora desde la cual la cta.cte se encuentra en ese estado | S | dateTime |
| factura | Comprobante que dio origen a la Cta.Cte | S | ComprobanteType |
| arrayNotasDCAsociadas | Listado de Comprobantes que intervienen en el cálculo del saldo. | N | ArrayComprobantesType |
| arrayFormasCancelacion | Formas de Cancelación | N | ArrayCodigos DescripcionesType |
| arrayRetenciones | lista de Retenciones | N | ArrayRetencionesType |
| arrayAjustesOperacion | lista de ajustes aplicados a la operación en la aceptación de la cuenta corriente, si los hubo. | N | ArrayAjustesOperacionType |
| importeInicial | Importe Inicial que se toma de la factura de crédito. | S | ImporteSimpleType |
| importeTotalNotasDC | Importe total de la suma de todas las notas de débito y crédito | N | ImporteSimpleType |
| importeCancelado | Importe Cancelado por el Comprador | N | ImporteSimpleType |
| importeTotalRetPesos | Importe total de | N | ImporteSimpleType |

---

|  | retenciones en pesos argentinos |  |  |
| --- | --- | --- | --- |
| importeEmbargoPesos | Importe de embargo en pesos | N | ImporteSimpleType |
| saldoAceptado | Saldo aceptado por el Comprador | N | ImporteSimpleType |
| saldo | Saldo Actual de la Cta.Cte.
Saldo de la operación comercial:
Importe de Factura +
Importe de las Notas de Débito (No rechazadas)
Importe de las Notas de Crédito (No rechazadas).
Ignora montos de cancelación, embargos, retenciones, etc. informados en la aceptación | S | ImporteSimpleType |
| codMoneda | Moneda utilizada en el cálculo de la Cta.Cte.
Misma moneda que los comprobantes que forman la Cta.Cte | S | String |
| cotizacionMonedaUlt | Última cotización informada en el último comprobante asociado a la Cta.Cte | S | Decimal |
| codMotivoRechazo | Motivo de rechazo de a Cta.Cte | N | Short |
| descMotivoRechazo | Detalle/Observación del motivo del rechazo. | N | Texto250SimpleType |

ArrayRetencionesType contiene uno o más elementos retencion del tipo RetencionType

| ArrayRetencionesType |  |
| --- | --- |
| e retencion [1..*] | RetencionType |

| RetencionType |  |
| --- | --- |
| codTipo | [1..1] short |
| importe | [1..1] ImporteSimpleType |
| porcentaje | [1..1] PorcentajeSimpleType |
| descripcion | [0..1] Texto250SimpleType |

---

Abreviaturas

RetencionType

| RetencionType |  |  |
| --- | --- | --- |
| codTipo | [1..1] | short |
| importe | [1..1] | ImporteSimpleType |
| porcentaje | [1..1] | PorcentajeSimpleType |
| descripcion | [0..1] | Texto250SimpleType |

| Campo/Grupo | Descripción | Oblig | Tipo |
| --- | --- | --- | --- |
| codTipo | Código del Tipo de Retención | S | Short |
| importe | Importe de la Retención | S | ImporteSimpleType |
| porcentaje | Porcentaje de la Retención | S | PorcentajeSimpleType |
| descMotivo | Descripción del motivo por el cual aplica un porcentaje de retención distinto al de tabla. Ver método consultarTiposRetenciones | N | Texto250SimpleType |

| ArrayTiposRetencionesType |  |
| --- | --- |
| tipoRetencion [1..*] | TipoRetencionType |

| TipoRetencionType |  |
| --- | --- |
| codigoJurisdiccion | [1..1] short |
| descripcionJurisdiccion | [1..1] string |
| porcentajeRetencion | [1..1] PorcentajeSimpleType |

TipoRetencionType

ArrayConfirmarNotasType contiene un elemento <confirmarNota> del tipo
ConfirmarNotaDCType

| Campo/Grupo | Descripción | Oblig | Tipo |
| --- | --- | --- | --- |
| codigoJurisdiccion | Código de la Jurisdicción | S | short |
| descripcionJurisdiccion | Descripción de la Jurisdicción | S | string |
| porcentajeRetencion | Porcentaje de la Retención | S | PorcentajeSimpleType |

---

ConfirmarNotaDCType

| ConfirmarNotaDCType |  |
| --- | --- |
| e accepta[1..1]SiNoSimpleType |  |
| e idNota[1..1]IdComprobanteType |  |

| Campo/Grupo | Descripción | Oblig | Tipo |
| --- | --- | --- | --- |
| acepta | Acepta la Nota de Débito o Crédito | S | short |
| idNota | Identificador del Comprobante | S | IdComprobante |

ArrayFacturasAgtDptoCltvType contiene uno o más elementos <facturaInformada>
del tipo FacturaInformadaAgtDptoCltvType

| ArrayFacturasAgtDptoCltvType | FacturaInformadaAgtDptoCltvType |
| --- | --- |
| facturaInformada[1..*] FacturaInformadaAgtDptoCltvType | idFactura[1..1] IdComprobanteTypeinfoAgtDptoCltv[1..1] InfoAgtDptoCltvType |

FacturaInformadaAgtDptoCltvType

| FacturaInformadaAgtDptoCltvType |  |
| --- | --- |
| idFactura [1..1] IdComprobanteType |  |
| infoAgtDptoCltv [1..1] InfoAgtDptoCltvType |  |
| IdComprobanteType |  |
| CUITEmisor [1..1] CuitSimpleType |  |
| codTipoCmp [1..1] short |  |
| ptoVta [1..1] PuntoVentaSimpleType |  |
| nroCmp [1..1] NumeroComprobanteSimpleType |  |

| InfoAgtDptoCltvType |  |  |
| --- | --- | --- |
| fechaInfo | [1..1] | date |
| ctaAgente | [1..1] | CuentaEnAgenteType |
| recibida | [1..1] | SiNoSimpleType |
| fechaLectura | [0..1] | date |
| fechaRecep | [0..1] | date |
| acceptada | [0..1] | SiNoSimpleType |
| motivoRechazo | [0..1] | string |
| idPagoAgtDptoCltv | [0..1] | string |
| CBUAgtDptoCltv | [0..1] | CBUSimpleType |

| Campo/Grupo | Descripción | Obliq | Tipo |
| --- | --- | --- | --- |
| idFactura | Identificación de la Factura Eletrónica de Crédito Informada | S | IdComprobanteType |
| infoAgtDptoCltv | Información referida a la solicitud de transferencia de esa factura al Agente de Depósito Colectivo | S | InfoAgtDptoCltv |

ArrayMotivosRechazoType contiene uno o más elementos <motivoRechazo> del tipo
MotivoRechazoType

| ArrayMotivosRechazoType |  |
| --- | --- |
| e motivoRechazo [1..*] MotivoRechazoType |  |

| MotivoRechazoType |  |  |
| --- | --- | --- |
| codMotivo | [1..1] | short |
| descMotivo | [1..1] | Texto250SimpleType |
| justificacion | [1..1] | Texto250SimpleType |

---

Abreviaturas

MotivoRechazoType

| MotivoRechazoType |  |
| --- | --- |
| codMotivo | [1..1] short |
| descMotivo | [1..1] Texto250SimpleType |
| justificacion | [1..1] Texto250SimpleType |

Texto250SimpleType

| Campo/Grupo | Descripción | Oblig | Tipo |
| --- | --- | --- | --- |
| codMotivo | Código del Tipo de Motivo de Rechazo normado | S | Short |
| descMotivo | Descripción del Tipo de Motivo de Rechazo normado | S | Texto250SimpleType |
| justificacion | Justificacion del rechazo | S | Texto250SimpleType |

ArraySubtotalesIVAType contiene uno o más elementos <subtotalIVA> del tipo
SubtotalIVAType

| ArraySubtotalesIVAType |  |  |
| --- | --- | --- |
| subtotalIVA | [1..*] | SubtotalIVAType |

| SubtotalIVAType |  |  |
| --- | --- | --- |
| codigo | [1..1] | short |
| baseImponible | [1..1] | ImporteSimpleType |
| importe | [1..1] | ImporteSimpleType |

SubtotalIVAType

| Campo/Grupo | Descripción | Oblig | Tipo |
| --- | --- | --- | --- |
| codigo | Código del Tipo de IVA | S | Short |
| baseImponible | Base sobre lo cual se impone el iva | S | ImporteSimpleType |
| importe | Importe Facturado para ese código de Tipo de IVA | S | ImporteSimpleType |

ArrayOtrosTributosType contiene uno o más elementos <otroTributo> del tipo
OtroTributoType

| Campo/Grupo | Descripción | Oblig | Tipo |
| --- | --- | --- | --- |
| codigo | Código del Tributo | S | Short |
| detalle | Detalle ingreso en la emisión del comprobante sobre el tributo | N | Texto250SimpleType |
| baseImponible | Base sobre lo cual se impone el tributo | S | ImporteSimpleType |
| importe | Importe del tributo | S | ImporteSimpleType |

| ArrayOtrosTributosType |
| --- |
| e otroTributo [1..*] OtroTributoType |

| OtroTributoType |  |  |
| --- | --- | --- |
| codigo | [1..1] | short |
| detalle | [0..1] | Texto250SimpleType |
| baseImponible | [1..1] | ImporteSimpleType |
| importe | [1..1] | ImporteSimpleType |

---

ArrayItemsType contiene uno o más elementos <item> del tipo ItemType

| ItemType |  |
| --- | --- |
| orden | [1..1] int |
| unidadesMtx | [0..1] int |
| codigoMtx | [0..1] string |
| codigo | [0..1] string |
| descripcion | [1..1] string |
| codNomMercosur | [0..1] string |
| cantidad | [0..1] DecimalSimpleType |
| codigoUnidadMedida | [0..1] short |
| precioUnitario | [0..1] ImporteSimpleType |
| importeBonificacion | [0..1] ImporteSimpleType |
| codigoCondicionIVA | [1..1] short |
| importeIVA | [0..1] ImporteSimpleType |
| importeItem | [1..1] ImporteSimpleType |

ItemType

| Campo/Grupo | Descripción | Oblig | Tipo |
| --- | --- | --- | --- |
| codigo | Código del Tributo | S | Short |
| detalle | Detalle ingresado en la emisión del comprobante sobre el tributo | N | Texto250SimpleType |
| baseImponible | Base sobre lo cual se impone el tributo | S | ImporteSimpleType |
| importe | Importe del tributo | S | ImporteSimpleType |

ArrayHistorialEstadosComprobanteType contiene uno o más elementos
<estadoHistorico> del tipo EstadoCmpType

| ArrayHistorialEstadosComprobanteType |
| --- |
| estadoHistorico [1..*] EstadoCmpType |

EstadoCmpType

| EstadoCmpType |  |
| --- | --- |
| estado | [1..1] EstadoCmpSimpleType |
| fechaHoraEstado | [1..1] dateTime |

| EstadoCmpType |  |
| --- | --- |
| estado | [1..1] EstadoCmpSimpleType |
| fechaHoraEstado | [1..1] dateTime |

---

ArrayHistorialEstadosCtaCteType contiene uno o más elementos <estadoHistorico> 
del tipo EstadoCtaCteType

| EstadoCtaCteType |  |
| --- | --- |
| e estado | [1..1] EstadoCtaCteSimpleType |
| e fechaHoraEstado | [1..1] dateTime |

EstadoCtaCteType

| EstadoCtaCteType |  |
| --- | --- |
| e estado | [1..1] EstadoCtaCteSimpleType |
| e fechaHoraEstado | [1..1] dateTime |

| Campo/Grupo | Descripción | Oblig | Tipo |
| --- | --- | --- | --- |
| estado | Estado de la cuenta corriente | S | EstadoCtaCteSimpleType |
| fechaHoraEstado | Fecha y hora desde la cual está en ese estado | S | dateTime |

ArrayAjustesOperacionType contiene uno o más elementos <ajuste> del tipo
AjusteOperacionType

| ArrayAjustesOperacionType |  |
| --- | --- |
| e | ajuste [1..*] AjusteOperacionType |

| AjusteOperacionType |
| --- |
| codigo [1..1] short |
| importe [1..1] ImporteSimpleType |

AjusteOperacionType

| AjusteOperacionType |
| --- |
| codigo [1..1] short |
| importe [1..1] ImporteSimpleType |

| Campo/Grupo | Descripción | Oblig | Tipo |
| --- | --- | --- | --- |
| codigo | Código del tipo de ajuste(obtenido deconsultarTiposAjustesOperacion) | S | short |
| importe | Importe del ajuste | S | ImporteSimpleType |

---

InfoTransferenciaType

| InfoTransferenciaType |  |
| --- | --- |
| infoAgtDptoCltv | [1..*] InfoAgtDptoCltvType |
| infoSCA | [1..1] InfoSCAType |

| InfoAgtDptoCltvType |  |  |
| --- | --- | --- |
| fechaInfo | [1..1] | date |
| ctaAgente | [1..1] | CuentaEnAgenteType |
| recibida | [1..1] | SiNoSimpleType |
| fechaLectura | [0..1] | date |
| fechaRecep | [0..1] | date |
| acceptada | [0..1] | SiNoSimpleType |
| motivoRechazo | [0..1] | string |
| idPagoAgtDptoCltv | [0..1] | string |
| CBUAgtDptoCltv | [0..1] | CBUSimpleType |

| InfoSCAType |  |  |
| --- | --- | --- |
| fechaAceptacionFactura | [1..1] | date |
| informaCBUReceptor | [1..1] | SiNoSimpleType |
| CBUReceptor | [0..1] | CBUSimpleType |
| CBUValidada | [0..1] | SiNoSimpleType |
| fechaLecturaSCA | [0..1] | dateTime |

Contiene un CHOICE que contiene uno y sólo uno de:

| Campo/Grupo | Descripción | Oblig | Tipo |
| --- | --- | --- | --- |
| infoAgtDptoCltv | Información referente a las solicitudes de transferencia de la factura a un agente de depósito colectivo | choice | InfoAgtDptoCltvType |
| infoSCA | Información referida a la transferencia de las facturas aceptadas con opción Sistema de Circulación Abierta | choice | InfoSCAType |

InfoAgtDptoCltvType

| InfoAgtDptoCltvType |  |  |
| --- | --- | --- |
| fechaInfo | [1..1] | date |
| ctaAgente | [1..1] | CuentaEnAgenteType |
| recibida | [1..1] | SiNoSimpleType |
| fechaLectura | [0..1] | date |
| fechaRecep | [0..1] | date |
| acceptada | [0..1] | SiNoSimpleType |
| motivoRechazo | [0..1] | string |
| idPagoAgtDptoCltv | [0..1] | string |
| CBUAgtDptoCltv | [0..1] | CBUSimpleType |

---

| ctaAgente | Información de la Cta en Agente seleccionada para informar oportunamente para esta factura | S | CuentaEnAgenteType |
| --- | --- | --- | --- |
| recibida | Confirmación de si fue recibida efectivamente por el Agente de Depósito Colectivo | S | SiNoSimpleType |
| fechaLectura | Fecha en la que el Agte de Depósito Colectivo tomó la información de los sistemas de AFIP | N | date |
| fechaRecep | Fecha dada por el Agte de Depósito Colectivo que la recepcionó | N | date |
| acceptada | Confirmación de si fue aceptada o rechazada (por algún inconveniente) por el agente de depósito colectivo | N | SiNoSimpleType |
| motivoRechazo | Si no fue aceptada por el Agente de Depósito Colectivo, el motivo indicado por este | N | string |
| idPagoAgDptoCltv | Identificador del pago para el Agente de depósito, si el comprobante está informado al Agente y aceptado por el mismo | N | string |
| CBUAgtDptoCltv | CBU donde debe efectuarse el pago del comprobante, figurará el CBU del Agente. | N | CBUSimpleType |

InfoSCAType

| Campo/Grupo | Descripción | Obliq | Tipo |
| --- | --- | --- | --- |
| fechaAceptacionFactura | Fecha en que fue aceptada la factura y dejada a disposición para la consulta del Sistema de Circulación Abierta | S | date |
| informaCBUReceptor | Indicación de si en la aceptación el receptor indicó una CBU | S | SiNoSimpleType |
| CBUReceptor | CBU indicada por el receptor en la aceptación, de corresponder | N | CBUSimpleType |

---

| CBUValidada | Indica si la CBU fue validada online con los sistemas dispuestos por el BCRA en el instante de la aceptación, de corresponder | N | SiNoSimpleType |
| --- | --- | --- | --- |
| fechaLecturaSCA | Fecha y hora en que el Sistema de Circulación Abierta consultó los datos de la factura en el sistema de AFIP | N | dateTime |

---

***Abreviaturas***

## 3.3 Aclaraciones y Definiciones

(1) No se especifica la longitud del atributo token y del atributo sign porque es variable y depende de la respuesta del WSAA.
(2) Formato para el tipo de dato date es: AAAA-MM-DD, sin uso horario.
(3) El separador de decimales es el punto “.”
(4) El método de redondeo a utilizar es Round Half Even.
(5) Error Absoluto y Error Relativo
Error Absoluto eabs: Es la diferencia entre el valor medido (calculado) y el valor real

Error Relativo erel: Es el cociente entre el valor error absoluto y el valor real.

En ambos casos se tomará el valor absoluto, es decir el signo resultante de la operación no se considerará.

## 82 de 88

---

***Abreviaturas***

## 3.4 Abreviaturas

(1) WSDL: Web Services Description Language.
(2) WS: Web Services.
(3) WSFECRED: Web Service para gestionar las Facturas Electrónicas de Crédito.
(4) Cta.Cte: Cuenta Corriente
(5) BCRA: Banco Central de la República Argentina
## 83 de 88

---

4 Change Log
Versión Fecha

| Versión | Fecha | Descripción de la Modificación |
| --- | --- | --- |
| 2.0.3 | 20/12/2023 | - Se modifica la validación correspondiente al código 2009 (cotizacion de moneda). No podrá ser inferior en un 2% del que suministra AFIP como orientativo de acuerdo a la cotizacion oficial |
| 2.0.2 | 29/12/2022 | - Se modifica la validación correspondiente al código 2009 (cotizacion de moneda). No podrá ser superior en un 400% del que suministra AFIP como orientativo de acuerdo a la cotizacion oficial |
| 2.0.1 | 29/12/2022 | - Se modifica la validación correspondiente al código 2009 (cotizacion de moneda). No podrá ser superior en un 200% del que suministra AFIP como orientativo de acuerdo a la cotizacion oficial |
| 2.0.0 | 18/11/2020 | - Se modifica el servicio para soportar la solicitud de informe del saldo negociable de las Facturas de Crédito Electrónicas a diferentes agentes de depósito colectivo
• Se reemplaza el tipo de dato ArrayCtaComitenteType por el ArrayCuentasEnAgenteType
• Se reemplaza el tipo de dato CuentaComitenteType por el CuentaEnAgenteType
• Se actualizan las operaciones que utilizan esos tipo de datos:
○ informarFacturaAgtDptoCltv y consultarFacturasAgtDptoCltv
○ se elimina la operación consultarCuentasComitentes
○ se crea una nueva operación consultarCuentasEnAgtDptoCltv
• Se incluye motivoRechazo en FacturaInformadaAgtDptoCltvType, si la misma fue rechazada por el Agente de Depósito Colectivo.
- Se modifica el servicio para soportar la nueva opción de transferencia de una factura de crédito al Sistema de Circulación Abierta:
• Se incorpora operación modificarOpcionTransferencia
• Se reorganiza información en ComprobanteType según estos cambios
• Se agregan campos en operación(acceptFECred) y nuevas validaciones con nuevos códigos de error y un caso de observación.
- Se agrega filtro optional en consultarCitasCtes para el campo opción de transferencia. Además se agrega ese campo en los datos resumidos de una Cuenta Corriente en InfoCtaCteType. |
| 1.3.0 | 11/02/2020 | - Se agrega como optional el página en las operaciones de consultarCobranantes y consultarClasCles.
- Se agrega código de error 12011 para la consultas paginas. |
| 1.2.0 | 04/02/2020 | - Se agrega la forma de cancelación“Locación de Bienes Inmuebles”y las validaciones pertinentes.
• Se actualiza mensaje en código de error 4003 reutilizado para esta nueva forma de cancelación
- Se quita validación a la operación de aceptación(acceptFECred) sobre los campos&lt;cotizacionMonedaAlt&gt;y&lt;arrayAjustesOperacion&gt;que resultaba en código error 2011 con mensaje“La cotización informada difiere con la de La Factura, debe informar ajuste por tipo de cambio.” |

---

| 1.1.2 | 08/11/2019 | -Se aclaran descripción de los campos de las operaciones de consultarComprobantes y consultarClasCtes respecto al rolCuitRepresentada>
-Se aclara la devolución de la observación con código 32767 para cuando no se encuentran resultados según los parámetros recibidos |
| --- | --- | --- |
| 1.1.0 | 30/05/2019 | -Se agregan las formas de cancelación “Cesión” y “Otros medios de pago habilitados por el BCRA”, y las validaciones pertinentes.
·Se agrega código de error 4003 por estas nuevas validaciones
·Se depreca la operación consultarObligadoRecepción
·Se crea nueva operación consultarMontoObligadoRecepción
·Se aclara saldo vs saldo aceptado en información del elemento CuentaCorrienteType
·Se aclara validación que arroja error de formato en el uso de IdClaeCteType en punto 1.3.2.1. |
| 1.0.3-rc1 | 24/05/2019 | -Se aclaran las descripciones de los métodos acceptarFECred e informarCancelaciónTotalFECred respecto a la cancelación total. |
| 1.0.0-rc1 | 12/03/2019 | -Se agregan validaciones para evitar la repetición de código de tipos de retenciones, formas de cancelación, motivos de rechazo y ajustes de operación en una misma cuenta corriente.
·Se agrega código error 2013
·Se corrigen descripciones de código de errores 2003, 3001 y 4002. |
| 1.0.0 | 11/03/2019 | -Se agregan código de error devueltos a partir de validaciones sobre los Ajustes de Operación. |
| 1.0-BETA.6 | 05/03/2019 | -Se agrega la posibilidad de informar ajustes a la operación en el método de aceptación(acceptarFECred)
-Se agregó un arreglo con los ajustes informados a la operación en la consulta de la cuenta corriente(CuentaCorrienteType)
-Se agregó método de consulta de los tipos de ajustes disponibles con su código y descripción(consultarTiposAjustesOperacion). |
| 1.0-BETA.5 | 22/02/2019 | -Se agregan campos: datosComerciales, datosGenerales, leyendaCommercial a ComprobanteType devueltos cuando son utilizados por el emisor del comprobante.
-Se agrega campo codCaCte a ComprobanteType para facilitar la navegación hacia la Cuenta Corriente.
-Se aclara que se puede aceptar y cancelar totalmente la cuenta corriente utilizando la misma operación(acceptarFECred).
-Se incorpora un diagrama de estados a la descripción de la operatoria. |
| 1.0-BETA.4 | 14/02/2019 | -Se agrega solicitud de al menos un motivo de rechazo en el rechazo de notas de débito o crédito(rechazarNotaDC).
-Se modifica indicación de motivo de rechazo en el rechazo de una FECred permitiendo el ingreso de más de un motivo(rechazarFECred)
-Se agrega información devuelta en los datos de un comprobante: referencias comerciales, CBU de pago, id de pago a Agente Depósito (cuando correspondida), arreglo de Subtotales de IVA, arreglo de otros tributos(informados en la emisión) y arreglo con el detalle de items facturados (cuando el comprobante es emitido por Mis Compobantes y WebService de Factura Electrónica RG N&quot;2904).(ver ComprobanteType)
-Se agrupun estado y fecha y hora de ingreso a ese estado en unos nuevos tipos(EstateCmpType y EstadoCtaCteType)
-Se agregan métodos para consulta de historial de estados por los que pasó un comprobante y una cuenta corriente(consultarHistoricalEstadosCtaCte) |

---

|  |  | consultarHistorialEstadosComprobante) |
| --- | --- | --- |
| 1.0-BETA.3 | 16/01/2019 | -Se corrige término Formas de Pago por Formas de Cancelación
·Se renombra método en punto 2.5.15 por consultarTiposFormasCancelacion
·Se renombran parámetros de los métodos utilizando el término “Formas de Cancelación” en lugar de “Formas de Pago”
-Se retorna datos de la Cuenta Comitente informada en el método de consulta de facturas informadas al Agente de Depósito Colectivo(nuevo elemento en FacturaInformadaAgtDptoCltvType)
-Se modifica método ConsultarObligados por ConsultarObligadoRecepción consultando si una CUIT determinada está obligada a recibir un Factura de Crédito Electrónica.Además, se agrega fecha desde en el response.
-Se corrigen los datos de una Cuenta Comitente en CuentaComitenteType
-Se agrega detalle en la consulta del resultado de solicitud de informe a caja de valores de la factura de crédito(ver FacturaInformadaAgteDptoCltvType)
-Se agrega información devuelta en datos de un comprobante(ver ComprobanteType)
-Se agrega código de la moneda(codMoneda) en resumen de datos de una cuenta corriente(ver InfoCtaCteType)
-Se agrega método para consultar los remitos asociados a un comprobante en su emisión(ver obtenerRemitos)
-Se renombran tipos y elementos en la consulta de cuentas comitentes del solicitante(consultarCuentasComitente)
-Se adecuan elementos“fechaXYZ”a“fechaHoraXYZ”para los que corresponden. |
| 1.0-BETA.2 | 22/11/2018 | Se completa y corrige la versión inicial |
| 1.0-BETA.1 | 16/11/2018 | Versión Inicial |