# WSFEX — Factura de Exportación — Manual para el desarrollador V.3.1.1 (R.G. N° 2.758)

> **Source (authoritative):** https://www.arca.gob.ar/ws/documentacion/manuales/WSFEX-Manualparaeldesarrollador_V3.1.1_ARCA.pdf
> **Retrieved:** 2026-07-15
> **Conversion:** local `pdftotext -layout` extraction of the official PDF (59 pages, Last-Modified 2025-08-29).
>
> **WARNING:** This markdown is a convenience copy for search/reference only. The
> official PDF at the source URL is the authoritative document. Exact-recovery
> details and fiscal rules MUST be verified against the PDF before implementation.

<!-- page 1 -->

Facturación Electrónica
           Factura de Exportación Versión 3.1.0
                                 R.G. N° 2.758




    Manuales para el desarrollador

Versión correspondiente al 18 de Agosto de 2025




            Agencia de Recaudación
                   y Control Aduanero

     Subdirección General de Sistemas
                    y Telecomunicaciones


                           ARCA-SDG SIT

                                    Página 1 de 59

---

<!-- page 2 -->

Especificaciones técnicas de Servicios Web -WSFEXV1



                                Historial de modificaciones
  Ver         Fecha           Edición                              Descripción
   0.1      29-11-2010      SDG SIT/DIF   Versión inicial del documento
   0.1      23-01-2010      SDG SIT/DIF   Versión inicial del documento
   0.2      26-01-2010      SDG SIT/DIF   Se agregó Dummy
   0.3      28-01-2010      SDG SIT/DIF   Se eliminó el método FEXGETPARAM_Fpago
   0.4      01-02-2010      SDG SIT/DIF   Se incorporaron métodos de consulta de cotización de mone-
                                          da FEXGetPARAM_Ctz; de estado de puntos de venta habili-
                                          tados FEXGetPARAM_PtoVenta y de verificación de existen-
                                          cia de Permiso de embarque FEXCheck_Permiso.
                                          Se corrigieron especificaciones de campo y sus longitudes.
                                          Se cambió la validación de fecha de comprobante, la longitud
                                          del campo id_impositivo, y la longitud del pro_codigo.
   0.5      04-02-2010      SDG SIT/DIF   Se modificó el campo <incoterms>; se incorporó el método de
                                          consulta de respectivo FEXGetPARAM_Incoterms.
                                          Se modifican parámetros de ingreso método FEXCheck_Per-
                                          miso
   0.6      10-02-2010      SDG SIT/DIF   Modificación de tipos datos en WSDL y agregado de campo
                                          en métodos FEXAuthorize y FEXGetCmp
   0.7      25-03-2010      SDG SIT/DIF   Correcciones varias en validaciones
   0.8      16-04-2010      SDG SIT/DIF   Modificación objeto Response del método FEXAuthorize
   0.9      26-04-2010      SDG SIT/DIF   Modificación control sobre Cmps_asoc en método FEXAutho-
                                          rize. Modificación precisión campo Imp_total
   1.0      01-04-2011      SDG SIT/DIF   Se levanta validación sobre los permisos de embarque para
                                          que acepte más de 5 permisos en un mismo request.
                                          A nivel de ítem, se amplía la cantidad de decimales para pre-
                                          cio unitario y cantidad a 6.
                                          Se cambia el formato de algunos campos por el tratamiento de
                                          decimales. El formato pasa de Double a Decimal.
                                          Se agrega bonificación a nivel de ítem. (6 decimales)
                                          Concepto de señas y bonificación general, a nivel del compro-
                                          bante.
                                          Los importes totales del ítem y del comprobante se limitan a 2
                                          decimales.
                                          Se valida el total del ítem y del comprobante con los márgenes
                                          de error absoluto y relativo indicados en Margen de error me-
                                          diante (Error Absoluto y Error Relativo) (criterio Round Half
                                          Even) a 5 decimales.
                                          Acepta total del ítem igual a cero, también se permite que el
                                          precio unitario sea 0.
                                          Se amplía la longitud máxima del campo <Obs_comerciales>
                                          a 4000 caracteres.
                                          Incoterms, solamente es obligatorio si es una factura (Cbte_Ti-
                                          po=19) y concepto igual a productos (Tipo_expo=1)
                                          Permite asociar remitos de tabaco. Esto es solamente para
                                          las empresas que exportan tabaco. Se modificó la estructura
                                          del array de comprobantes asociados para que pueden infor-
                                          mar la CUIT en caso de ser un remito tabaco realizado por un
                                          tercero.
                                          Se reemplaza el nombre del campo Tipo_cbte por Cbte_Tipo.
                                          Se reemplaza el nombre del método FEXGetPARAM_Tipo_-
                                          Cbte por FEXGetPARAM_Cbte_Tipo
   1.1      06-01-2014      SDG SIT/DIF   Se agrega validación sobre la cotización de la moneda extran-
                                          jera.
   1.2      30-12-2014      SDG SIT/DIF   Se agrega validación sobre los emisores de comprobantes de
                                          Servicios.
   1.3      22-09-2017      SDG SIT/DIF   Se agrega estructura de datos opcionales para dar soporte a
                                          Exporta-Simple.
                                          Se agregan las validaciones del 2000 al 2030 al momento de
                                          autorizar el comprobante.




                                                                                                    Página 2 de 59

---

<!-- page 3 -->

Especificaciones técnicas de Servicios Web -WSFEXV1
   1.4      01-10-2018      SDG SIT/DIF   Se amplía el campo punto de venta de numérico de 4 a numé-
                                          rico de 5.

                                          Se modifica la estructura general de los mensajes de respues-
                                          ta incluyendo información adicional al header del response
                                          (ver punto 1.4).
                                          Se modifican las validaciones 1510, 1667, 1690
  1.4.2     26-01-2019      SDG SIT/DIF   Se quita la validación 2033

                                          Se modifica la validación 1500
  1.5.0     31-01-2019      SDG SIT/DIF   Para las validaciones de Comprobantes de Servicios se reali-
                                          zaron los siguientes cambios:

                                             -   Se modifica la validación 1590
                                             -   Se agregan los siguientes 3códigos: 2040 a la 2054

                                             -   Se agrega el siguiente método: FEXGetPARAM_MO-
                                                 N_CON_COTIZACION, apartado 2.19

                                          También se agregan las siguientes validaciones generales:
                                                   2031 y 2032
  1.6.0     23-09-2019      SDG SIT/DIF   Se modifica la validación 1668. Cuando el tipo de exportación
                                          es 4 (Tipo_expo=4) no se valida que se encuentre registrado
                                          como exportador.
                                          Se agrega fecha de pago en autorización y consulta de com-
                                          probantes que son del tipo Factura de Servicios u Otros. Vali-
                                          daciones 1671, 1672, 1673, 1674. Para dar soporte al requeri-
                                          miento se modifican los complexType ClsFEXRequest y
                                          ClsFEXGetCMPR. La fecha de pago debe informarse, a partir
                                          del 01/11/2019 será obligatorio.
                                          Se agrega el siguiente código de validación 2055
  1.7.0     20-11-2019      SDG SIT/DIF   Se agrega funcionalidad de exportación simplificada.

                                          Se dan de baja los sig. códigos; 2000, 2009, 2014, 2015,
                                          2024, 2025, 2030
                                          Se modifican los sig. códigos: 2005, 2006, 2007, 2008, 2010,
                                          2026, 2027
                                          Se dan de alta los sig. códigos: 2056, 2057, 2058, 2059, 2060,
                                          2061
  1.8.0     04-11-2020      SDG SIT/DIF   Se agrega validación funcional al momento de invocar al mé-
                                          todo FEXCheck_Permiso bajo el mismo código 1810
  1.9.0     14-09-2021      SDG SIT/DIF   Se agrega funcionalidad de exportación simplificada version 2

                                          Se dan de baja los sig. códigos; 2000, 2009, 2014, 2015,
                                          2024, 2025, 2030
                                          Se modifican los sig. códigos: 2005, 2006, 2007, 2008, 2010,
                                          2026, 2027
                                          Se dan de alta los sig. códigos: 2056, 2057, 2058, 2059, 2060,
                                          2061
 1.10.0     01-01-2023      SDG SIT/DIF   Se modifica la validación del código 1667




                                                                                                   Página 3 de 59

---

<!-- page 4 -->

Especificaciones técnicas de Servicios Web -WSFEXV1
  2.0.0     01-02-2023      SDG SIT/DIF   Según las resoluciones de remitos Harineros RG 5264/2022
                                          procedemos a hacer las adecuaciones del servicio mediante
                                          las sig. actualizaciones:

                                          Se agrega un método público “FEXGetPARAM_Actividades“,
                                          que permite determinar todas las actividades vigentes del
                                          emisor del comprobante.

                                          Se agrega una estructura de actividades vinculadas al
                                          comprobante tanto en el método “FEXAuthorize”, como en las
                                          consultas de los comprobantes ya autorizados.
                                          Se agregan una lista de códigos con validaciones con el
                                          objetivo de controlar las actividades y los remitos asociados
                                          según correspondan.

                                          Para FEXAuthorize, se dan de alta los sig. códigos:
                                          1821, 1822, 1823, 2100, 2101, 2102, 2103, 2104, 2105, 2106,
                                          2107, 2108, 2109, 2110, 2111, 2112, 2113

                                          De obtenerse los sig. códigos de validación: 2107, 2108, 2109,
                                          2110, 2111, 2112, 2113
                                          Si la actividad es Harina y la fecha de emisión se encuentra
                                          comprendida entre el 01/02/2023 y el 28/02/2023 los códigos
                                          SOLO observan el comprobante. Con fecha igual o posterior
                                          al 01/03/2023 los comprobantes pasan a quedar rechazados.
                                          Se modifican los sig. códigos: 1755, 1818, 1819, 1667
  2.0.1     15-03-2023      SDG SIT/DIF   Se extienden las adecuaciones de la versión anterior (2.0.0)
                                          para los remitos de Tabaco Acondicionado según lo dispuesto
                                          en la RG 5264/2022
  2.1.0     03-01-2024      SDG SIT/DIF   Se agregan validaciones con observaciones 14, 15, 16 y 17.
                                          Ver apartado “Otras Observaciones”.
  3.0.0     17-03-2025      SDG SIT/DIF   Se agrega el campo <CanMisMonExt> sobre el método
                                          público ‘FEXAuthorize’. De informarse, solo corresponde para
                                          Facturas (cod 19) y moneda distinta a pesos Argentinos. No
                                          debe informarse si la Factura es en Pesos o el tipo de
                                          comprobante es Nota de Débito/Crédito.

                                          Si se indica en la Factura que “El pago se realiza en la misma
                                          moneda”, y corresponde a una de las monedas con cotización
                                          en Banco Nación, la cotización debe coincidir exactamente
                                          con la registrada en las Bases del Organismo para el día hábil
                                          cambiario anterior a la fecha del comprobante, excepto que el
                                          comprobante sea generado con una fecha posterior a la fecha
                                          actual, en ese caso se tomará la cotización del día hábil
                                          cambiario anterior a la fecha actual.
                                          Por otro lado, si se indica en la Factura que “El pago se realiza
                                          en la misma moneda” puede omitir el campo de Cotización de
                                          Moneda y en este caso se registrará el comprobante con la
                                          cotizacion registrada en las bases del Organismo.

                                          Asimismo se agregan los siguientes códigos de errores: 1602,
                                          1603, 1604 1605

                                          Se modifica el método "FEXGetPARAM_Ctz", agregando de
                                          forma opcional la fecha de la cotización <FchCotiz > a querer
                                          consultar. Se agrega el código de error 1003 para validar el
                                          nuevo campo.

                                          Se modifica el método de consulta de comprobantes
                                          “FEXGetCMP” con el fin de recibir en el response el nuevo
                                          campo opcional <CanMisMonExt>.
  3.1.0     10-08-2025      SDG SIT/DIF   Se agregan validaciones al método de consulta
                                          FEXGetLast_CMP. Los nuevos códigos de error son 1606 y
                                          1607 para validar los campos Cbte_Tipo y Pto_venta
                                          respectivamente.
  3.1.1     18-08-2025      SDG SIT/DIF   Se agrega el código 21 para FEXAuthorize.




                                                                                                      Página 4 de 59

---

<!-- page 5 -->

Especificaciones técnicas de Servicios Web -WSFEXV1



                                                                          Contenido
1 INTRODUCCIÓN.............................................................................................................................................7
1.1 OBJETIVO.......................................................................................................................................................7
1.2 ALCANCE........................................................................................................................................................7
1.3 AUTENTICACIÓN..............................................................................................................................................7
1.4 ESTRUCTURA GENERAL DEL MENSAJE DE RESPUESTA (RESPONSE)..................................................................7
1.5 MANEJO TRANSACCIONAL...............................................................................................................................8
1.6 TRATAMIENTO DE ERRORES EN EL WS............................................................................................................9
1.7 TRATAMIENTO DE EVENTOS EN EL WS............................................................................................................9
1.8 DIRECCIÓN URL..........................................................................................................................................10
1.9 CANALES DE ATENCIÓN................................................................................................................................10
1.10 SITIOS DE CONSULTA..................................................................................................................................10
2 WS DE NEGOCIO..........................................................................................................................................11
2.1 AUTORIZADOR (FEXAUTHORIZE)...................................................................................................................11
2.1.1 DIRECCIÓN URL.......................................................................................................................................11
2.1.2 ESQUEMÁTICO DE ESTRUCTURA DEL REQUERIMIENTO................................................................................ 11
2.1.3 MENSAJE DE SOLICITUD.............................................................................................................................11
2.1.4 MENSAJE DE RESPUESTA...........................................................................................................................16
2.1.5 VALIDACIONES DE CABECERA Y ERRORES..................................................................................................17
2.1.6 VALIDACIONES DE NEGOCIO Y ERRORES.....................................................................................................17
2.1.7 OTROS ERRORES......................................................................................................................................26
2.1.8 OTRAS OBSERVACIONES/RECHAZOS..........................................................................................................26
2.1.9 EJEMPLO REQUEST 1................................................................................................................................26
2.1.10 EJEMPLO REQUEST 2 (CON COMPROBANTE ASOCIADO)............................................................................27
2.1.11 EJEMPLO REQUEST 3 (CON BONIFICACIÓN A NIVEL DE ÍTEM, CAMPO PRO_BONIFICACION).........................28
2.1.12 EJEMPLO REQUEST 4 (CON BONIFICACIÓN / DESCUENTO GLOBAL)............................................................29
2.2 RECUPERADOR DE COMPROBANTE (FEXGETCMP).......................................................................................30
2.2.1 DIRECCIÓN URL.......................................................................................................................................30
2.2.2 MENSAJE DE SOLICITUD.............................................................................................................................31
2.2.3 MENSAJE DE RESPUESTA...........................................................................................................................31
2.2.4 ERRORES..................................................................................................................................................34
2.3 RECUPERADOR DE ÚLTIMO VALOR DE ID DE REQUERIMIENTO (FEXGETLAST_ID)...........................................34
2.3.1 DIRECCIÓN URL.......................................................................................................................................34
2.3.2 MENSAJE DE SOLICITUD.............................................................................................................................34
2.3.3 MENSAJE DE RESPUESTA...........................................................................................................................35
2.3.4 VALIDACIONES, ACCIONES Y ERRORES.......................................................................................................35
2.4 RECUPERADOR DEL ÚLTIMO CBTE_NRO AUTORIZADO (FEXGETLAST_CMP)..................................................36
2.4.1 DIRECCIÓN URL.......................................................................................................................................36
2.4.2 MENSAJE DE SOLICITUD.............................................................................................................................36
2.4.3 MENSAJE DE RESPUESTA...........................................................................................................................36
2.4.4 VALIDACIONES, ACCIONES Y ERRORES.......................................................................................................37
2.5 RECUPERADOR DE VALORES REFERENCIALES DE CÓDIGOS DE MONEDA (FEXGETPARAM_MON)................37
2.5.1 DIRECCIÓN URL.......................................................................................................................................37
2.5.2 MENSAJE DE SOLICITUD.............................................................................................................................37
2.5.3 MENSAJE DE RESPUESTA...........................................................................................................................38
2.5.4 VALIDACIONES, ACCIONES Y ERRORES.......................................................................................................38
2.6 RECUPERADOR DE VALORES REFERENCIALES DE CÓDIGOS DE TIPOS DE COMPROBANTE
(FEXGETPARAM_CBTE_TIPO)..........................................................................................................................39
2.6.1 DIRECCIÓN URL.......................................................................................................................................39
2.6.2 MENSAJE DE SOLICITUD.............................................................................................................................39
2.6.3 MENSAJE DE RESPUESTA...........................................................................................................................39
2.6.4 VALIDACIONES, ACCIONES Y ERRORES.......................................................................................................40
2.7 RECUPERADOR DE VALORES REFERENCIALES DE CÓDIGOS DE TIPO DE EXPORTACIÓN
(FEXGETPARAM_TIPO_EXPO)..........................................................................................................................40
2.7.1 DIRECCIÓN URL.......................................................................................................................................40
2.7.2 MENSAJE DE SOLICITUD.............................................................................................................................40
2.7.3 MENSAJE DE RESPUESTA...........................................................................................................................41
2.7.4 VALIDACIONES, ACCIONES Y ERRORES.......................................................................................................42
2.8 RECUPERADOR DE VALORES REFERENCIALES DE CÓDIGOS DE UNIDADES DE MEDIDA (FEXGETPARAM_UMED)
...........................................................................................................................................................................42
2.8.1 DIRECCIÓN URL.......................................................................................................................................42
2.8.2 MENSAJE DE SOLICITUD.............................................................................................................................42
2.8.3 MENSAJE DE RESPUESTA...........................................................................................................................42
2.8.4 VALIDACIONES, ACCIONES Y ERRORES.......................................................................................................43
2.9 RECUPERADOR DE VALORES REFERENCIALES DE CÓDIGOS DE IDIOMAS (FEXGETPARAM_IDIOMAS).............43


                                                                                                                                                          Página 5 de 59

---

<!-- page 6 -->

Especificaciones técnicas de Servicios Web -WSFEXV1
2.9.1 DIRECCIÓN URL.......................................................................................................................................43
2.9.2 MENSAJE DE SOLICITUD.............................................................................................................................44
2.9.3 MENSAJE DE RESPUESTA...........................................................................................................................44
2.9.4 VALIDACIONES, ACCIONES Y ERRORES.......................................................................................................45
2.10 RECUPERADOR DE VALORES REFERENCIALES DE CÓDIGOS DE PAÍSES (FEXGETPARAM_DST_PAIS)..........45
2.10.1 DIRECCIÓN URL.....................................................................................................................................45
2.10.2 MENSAJE DE SOLICITUD...........................................................................................................................45
2.10.3 MENSAJE DE RESPUESTA.........................................................................................................................46
2.10.4 VALIDACIONES, ACCIONES Y ERRORES.....................................................................................................46
2.11 RECUPERADOR DE VALORES REFERENCIALES DE INCOTERMS (FEXGETPARAM_INCOTERMS).....................46
2.11.1 DIRECCIÓN URL.....................................................................................................................................46
2.11.2 MENSAJE DE SOLICITUD...........................................................................................................................47
2.11.3 MENSAJE DE RESPUESTA.........................................................................................................................47
2.11.4 VALIDACIONES, ACCIONES Y ERRORES.....................................................................................................48
2.12 RECUPERADOR DE VALORES REFERENCIALES DE CUITS DE PAÍSES (FEXGETPARAM_DST_CUIT)...........48
2.12.1 DIRECCIÓN URL.....................................................................................................................................48
2.12.2 MENSAJE DE SOLICITUD...........................................................................................................................48
2.12.3 MENSAJE DE RESPUESTA.........................................................................................................................49
2.12.4 VALIDACIONES, ACCIONES Y ERRORES.....................................................................................................49
2.13 RECUPERADOR DE COTIZACIÓN DE MONEDA (FEXGETPARAM_CTZ)..........................................................49
2.13.1 DIRECCIÓN URL.....................................................................................................................................49
2.13.2 MENSAJE DE SOLICITUD...........................................................................................................................50
2.13.3 MENSAJE DE RESPUESTA.........................................................................................................................50
2.13.4 VALIDACIONES, ACCIONES Y ERRORES.....................................................................................................51
2.14 RECUPERADOR DE LOS PUNTOS DE VENTA ASIGNADOS A FACTURACIÓN ELECTRÓNICA DE COMPROBANTES DE
EXPORTACIÓN VÍA WEB SERVICES (FEXGETPARAM_PTOVENTA).......................................................................51
2.14.1 DIRECCIÓN URL.....................................................................................................................................51
2.14.2 MENSAJE DE SOLICITUD...........................................................................................................................51
2.14.3 MENSAJE DE RESPUESTA.........................................................................................................................51
2.14.4 VALIDACIONES, ACCIONES Y ERRORES.....................................................................................................52
2.15 RECUPERADOR DE VALORES REFERENCIALES DE CÓDIGOS DE TIPOS DE DATOS OPCIONALES
(FEXGETPARAM_OPCIONALES).........................................................................................................................52
2.15.1 DIRECCIÓN URL.....................................................................................................................................52
2.15.2 MENSAJE DE SOLICITUD...........................................................................................................................52
2.15.3 MENSAJE DE RESPUESTA.........................................................................................................................53
2.15.4 VALIDACIONES, ACCIONES Y ERRORES.....................................................................................................54
2.16 VERIFICADOR DE EXISTENCIA DE PERMISO/PAÍS DE DESTINACIÓN EN BASES DE DATOS ADUANERAS
(FEXCHECK_PERMISO).......................................................................................................................................54
2.16.1 DIRECCIÓN URL.....................................................................................................................................54
2.16.2 MENSAJE DE SOLICITUD...........................................................................................................................54
2.16.3 MENSAJE DE RESPUESTA.........................................................................................................................54
2.16.4 VALIDACIONES, ACCIONES Y ERRORES.....................................................................................................55
2.17 MÉTODO DUMMY PARA VERIFICACIÓN DE FUNCIONAMIENTO DE INFRAESTRUCTURA (FEXDUMMY).................55
2.17.1 DIRECCIÓN URL.....................................................................................................................................55
2.17.2 MENSAJE DE SOLICITUD...........................................................................................................................55
2.17.3 MENSAJE DE RESPUESTA.........................................................................................................................56
2.18 MARGEN DE ERROR MEDIANTE (ERROR ABSOLUTO Y ERROR RELATIVO)......................................................56
2.19 RECUPERADOR DE VALORES REFERENCIALES DE CÓDIGOS DE MONEDA
(FEXGETPARAM_MON_CON_COTIZACION).................................................................................................57
2.19.1 DIRECCIÓN URL.....................................................................................................................................57
2.19.2 MENSAJE DE SOLICITUD...........................................................................................................................57
2.19.3 MENSAJE DE RESPUESTA.........................................................................................................................57
2.19.4 VALIDACIONES, ACCIONES Y ERRORES.....................................................................................................58
2.20 RECUPERA EL LISTADO DE LAS DIFERENTES ACTIVIDADES HABILITADAS PARA EL EMISOR
(FEXGETPARAM_ACTIVIDADES)........................................................................................................................58
2.20.1 DIRECCIÓN URL.....................................................................................................................................58
2.20.2 MENSAJE DE SOLICITUD...........................................................................................................................58
2.20.3 MENSAJE DE RESPUESTA.........................................................................................................................59
2.20.4 VALIDACIONES, ACCIONES Y ERRORES.....................................................................................................59




                                                                                                                                           Página 6 de 59

---

<!-- page 7 -->

Especificaciones técnicas de Servicios Web -WSFEXV1



1 Introducción




1.1     Objetivo

Este documento está dirigido a quienes tengan que desarrollar el cliente consumidor de los Web-
Services correspondientes al servicio de Facturación Electrónica - Factura de exportación (WS-
FEXV1).

1.2     Alcance

Este documento brinda las especificaciones técnicas para desarrollar el cliente de WebServices
para usar el WSFEXV1. Debe complementarse con los documentos relativos a: Servicio de Auten-
ticación y Autorización y Establecimiento del canal de comunicación.

1.3     Autenticación

Para utilizar cualquiera de los métodos disponibles en el presente WS es necesario un Ticket de
Acceso provisto por el WS de Autenticación y Autorización (WSAA).

Recordar que para consumir el WS de Autenticación y Autorización WSAA es necesario obtener
previamente un certificado digital desde clave fiscal y asociarlo al ws de negocio "Factura Elec-
trónica de exportación".

Al momento de solicitar un Ticket de Acceso por medio del WS de Autenticación y Autorización
WSAA tener en cuenta que debe enviar el tag service con el valor "wsfex" y que la duración del
mismo es de 12 hs.


Para más información deberá redirigirse a los manuales www.arca.gob.ar/ws.


1.4     Estructura general del mensaje de Respuesta (response)

Los mensajes de respuesta que se transmiten tienen implementado el subelemento FEHeaderInfo
contenido en el elemento opcional Header, que se contempla en la estructura SOAP. En este
webservice se utiliza para brindar información contextual relacionada con el proceso del mensaje.
El procesamiento de dicha información no es obligatoria en los respectivos clientes, pero
contribuye con información contextual de procesamiento que es de utilidad ante posibles
eventualidades.
Ejemplo de mensaje de respuesta en el ambiente de Testing
<soap:Envelope                        xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
xmlns:xsd="http://www.w3.org/2001/XMLSchema">
 <soap:Header>
      <FEHeaderInfo xmlns="http://ar.gov.afip.dif.fexv1/">
       <ambiente>Homologacion - Clo</ambiente>
       <fecha>2018-09-26T12:57:46.2466835-03:00</fecha>



                                                                                        Página 7 de 59

---

<!-- page 8 -->

Especificaciones técnicas de Servicios Web -WSFEXV1

       <id>1.0.3.0</id>
      </FEHeaderInfo>
 </soap:Header>
 <soap:Body>
 </soap:Body>
</soap:Envelope>


Ejemplo de mensaje de respuesta en el ambiente de Producción
<soap:Envelope                        xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
xmlns:xsd="http://www.w3.org/2001/XMLSchema">
 <soap:Header>
      <FEHeaderInfo xmlns="http://ar.gov.afip.dif.fexv1/">
       <ambiente>Produccion - Pto</ambiente>
       <fecha>2018-09-26T12:57:46.2466835-03:00</fecha>
       <id>1.0.3.0</id>
      </FEHeaderInfo>
 </soap:Header>
 <soap:Body>
 </soap:Body>
</soap:Envelope>

1.5     Manejo transaccional

Es común que se produzcan interrupciones en la comunicación entre el cliente y el servicio web.
WSFEXV1 ha sido diseñado para tener en cuenta este tipo de situaciones. A continuación se
describen los problemas y su correspondiente solución:


      a) Se corta la comunicación cuando el usuario envía la solicitud de CAE hacia WSFEXV1
      Solución: El usuario simplemente vuelve a enviar la misma solicitud de CAE (igual Cmp .Id) a
      WSFEXV1, a efectos de que este la procese. WSFEXV1 devuelve FEXResultAuth con el
      campo <Reproceso> = "N".


      b) Se corta la comunicación cuando WSFEXV1 envía la respuesta hacia el cliente (error de
         time-out)
      WSFEXV1 almacena en su base de datos todas las solicitudes de CAE que fueron aprobadas.
      Solución: En este caso el usuario simplemente debe volver a enviar la misma solicitud de CAE
      (igual Cmp.Id) a WSFEXV1. El sistema busca la solicitud recibida en su base de datos y, si la
      encuentra, retorna la respuesta con el campo <Reproceso> = "S". Si no la encuentra, la
      procesa normalmente, generando una respuesta con el campo <Reproceso>="N".


De esta descripción surgen algunas conclusiones importantes:


         ● Es fundamental asegurarse de no repetir accidentalmente el <Id>. A estos efectos, se
         puede utilizar, por ejemplo, algún elemento tipo sequence generado por el motor de base
         de datos en uso, o alguna representación numérica de la fecha/hora.



                                                                                        Página 8 de 59

---

<!-- page 9 -->

Especificaciones técnicas de Servicios Web -WSFEXV1
         ● Debe archivarse el <Id> de cada solicitud puesto que va a ser el único modo de
         recuperar en caso de error en la comunicación de retorno de la información.
         ● En el caso de olvido o confusión respecto de alguno de estos datos, WSFEXV1 provee
         los siguientes métodos:
                -   FEXGetLast_ID: Este método devuelve el último <Id> (el máximo) recibido por
                    WSFEXV1.
                -   FEXGetLast_CMP: Este método devuelve el último comprobante recibido y
                    aprobado por WSFEXV1, para un tipo de comprobante y punto de venta dados.

1.6   Tratamiento de errores en el WS

El tratamiento de errores en todos los servicios se realizará de la siguiente manera:


          <s:element minOccurs="0" maxOccurs="1" name="FEXErr" type="tns:ClsFEXErr" />
          ...
         <s:complexType name="ClsFEXErr">
             <s:sequence>
                 <s:element minOccurs="1" maxOccurs="1" name="ErrCode" type="s:int" />
                 <s:element minOccurs="0" maxOccurs="1" name="ErrMsg" type="s:string" />
             </s:sequence>
          </s:complexType>


Dónde:
     Campo                                       Detalle                                   Obligatorio
FEXErr                 Información correspondiente al error. Contiene los datos de              S
                       ErrCode y ErrMsg
ErrCode                Código de error                                                         S
ErrMsg                 Mensaje de error                                                        S


Para errores internos de infraestructura, los errores se devuelven en la misma estructura (FEXErr)
Los códigos de error son:
      Código de error                                      Mensaje de error
           500                   Error interno de aplicación.
           501                   Error interno de base de datos.
         502/505                 Error interno – Autorizador - Transacción Activa



1.7      Tratamiento de eventos en el WS

Todos los métodos del Web service cuentan con una sección para la comunicación de eventos de
ARCA para los clientes, los mismos tienen dos campos: EventCode y EventMsg, el primero
contiene el Identificador de mensaje y el segundo, es el mensaje propiamente dicho.
Ejemplo:
         EventCode =1
         EventMsg=”Por razones de mantenimiento este servicio estará fuera de línea el 1 de enero
         del 2020 de 17 a 19 hs.”

         <s:element minOccurs="0" maxOccurs="1" name="FEXEvents"
         type="tns:ClsFEXEvents" />
             ...
         <s:complexType name="ClsFEXEvents">
            <s:sequence>
              <s:element minOccurs="1" maxOccurs="1" name="EventCode" type="s:int" />
              <s:element minOccurs="0" maxOccurs="1" name="EventMsg" type="s:string" />
            </s:sequence>
         </s:complexType>


                                                                                                   Página 9 de 59

---

<!-- page 10 -->

Especificaciones técnicas de Servicios Web -WSFEXV1




Dónde:
     Campo                                      Detalle                              Obligatorio
FEXEvents             Información correspondiente a eventos. Contiene los datos de        S
                      EventCode y EventMsg
EventCode             Código de evento (único e irrepetible)                             S
EventMsg              Mensaje                                                            S



1.8    Dirección URL

       Este servicio se llama en Homologación desde:
         https://wswhomo.afip.gov.ar/wsfexv1/service.asmx


       Para visualizar el WSDL en Homologación:
         https://wswhomo.afip.gov.ar/wsfexv1/service.asmx?WSDL


       Este servicio se llama en Producción desde:
         https://servicios1.afip.gov.ar/wsfexv1/service.asmx


       Para visualizar el WSDL en Producción:
         https://servicios1.afip.gov.ar/wsfexv1/service.asmx?WSDL

1.9    Canales de Atención

       Consultas sobre el ambiente de homologación:

       - Acerca de certificados y accesos, consultar sitio http://www.arca.gob.ar/ws/


       Consultas sobre el ambiente de producción:

       - sri@arca.gov.ar

       Consultas sobre normativa:

       - facturaelectronica@arca.gov.ar



1.10 Sitios de Consulta

Biblioteca Electrónica

ABC – Consultas y Respuestas Frecuentes sobre:

      - Funcionalidades del WS

      - Normativa, Aplicativos y Sistemas. Opción Facturación y Registración

Documentación de Ayuda



                                                                                             Página 10 de 59

---

<!-- page 11 -->

Especificaciones técnicas de Servicios Web -WSFEXV1
        -    http://www.afip.gob.ar/fe/ayuda.asp.




2 WS de Negocio




2.1         Autorizador (FEXAuthorize)

2.1.1        Dirección URL


Este servicio se llama desde:
http://wswhomo.afip.gov.ar/wsfexv1/service.asmx
Service.asmx es el webservice global cada uno de sus métodos es invocado con esta url mas el
parámetro “op” con el nombre del método
Ejemplo: http://wswhomo.afip.gov.ar/wsfexv1/service.asmx?op=FEXAuthorize


2.1.2        Esquemático de estructura del requerimiento
  Comprobante y estructura WS


      Emisor                        Tipo y Numeración


      Cliente




      Doc. Aduaneros                Doc. Asociados
      …….                           …….
      …….                           …….

      Items
      …….                                                  <Cmps_asoc>
      …….
      …….                                                  <Permisos>


                                                           <Cmps>


                                                           <Items>
                                    Totales




2.1.3        Mensaje de solicitud
Recibe la información del comprobante a autorizar.



                                                                                 Página 11 de 59

---

<!-- page 12 -->

Especificaciones técnicas de Servicios Web -WSFEXV1

        <?xml version="1.0" encoding="utf-8"?>
        <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-
        instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"
        xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
          <soap:Body>
            <FEXAuthorize xmlns="http://ar.gov.afip.dif.fexv1/">
                <Auth>
                  <Token>string</Token>
                  <Sign>string</Sign>
                  <Cuit>long</Cuit>
                </Auth>
                <Cmp>
                  <Id>long</Id>
                  <Fecha_cbte>string</Fecha_cbte>
                  <Cbte_Tipo>short</Cbte_Tipo>
                  <Punto_vta>int</Punto_vta>
                  <Cbte_nro>long</Cbte_nro>
                  <Tipo_expo>short</Tipo_expo>
                  <Permiso_existente>string</Permiso_existente>
                  <Permisos>
                    <Permiso>
                       <Id_permiso>string</Id_permiso>
                       <Dst_merc>int</Dst_merc>
                    </Permiso>
                    <Permiso>
                       <Id_permiso>string</Id_permiso>
                       <Dst_merc>int</Dst_merc>
                    </Permiso>
                  </Permisos>
                  <Dst_cmp>short</Dst_cmp>
                  <Cliente>string</Cliente>
                  <Cuit_pais_cliente>long</Cuit_pais_cliente>
                  <Domicilio_cliente>string</Domicilio_cliente>
                  <Id_impositivo>string</Id_impositivo>
                  <Moneda_Id>string</Moneda_Id>
                  <Moneda_ctz>decimal</Moneda_ctz>
                  <CanMisMonExt>string</CanMisMonExt>
                  <Obs_comerciales>string</Obs_comerciales>
                  <Imp_total>decimal</Imp_total>
                  <Obs>string</Obs>
                  <Cmps_asoc>
                    <Cmp_asoc>
                       <Cbte_tipo>short</Cbte_tipo>
                       <Cbte_punto_vta>int</Cbte_punto_vta>
                       <Cbte_nro>long</Cbte_nro>
                       <Cbte_cuit>long</Cbte_cuit>
                    </Cmp_asoc>
                    <Cmp_asoc>
                       <Cbte_tipo>short</Cbte_tipo>
                       <Cbte_punto_vta>int</Cbte_punto_vta>
                       <Cbte_nro>long</Cbte_nro>
                       <Cbte_cuit>long</Cbte_cuit>
                    </Cmp_asoc>
                  </Cmps_asoc>
                  <Forma_pago>string</Forma_pago>
                  <Incoterms>string</Incoterms>
                  <Incoterms_Ds>string</Incoterms_Ds>
                  <Idioma_cbte>short</Idioma_cbte>
                  <Items>
                    <Item>
                       <Pro_codigo>string</Pro_codigo>
                       <Pro_ds>string</Pro_ds>
                       <Pro_qty>decimal</Pro_qty>
                       <Pro_umed>int</Pro_umed>
                       <Pro_precio_uni>decimal</Pro_precio_uni>
                       <Pro_bonificacion>decimal</Pro_bonificacion>


                                                                      Página 12 de 59

---

<!-- page 13 -->

Especificaciones técnicas de Servicios Web -WSFEXV1

                      <Pro_total_item>decimal</Pro_total_item>
                   </Item>
                   <Item>
                      <Pro_codigo>string</Pro_codigo>
                      <Pro_ds>string</Pro_ds>
                      <Pro_qty>decimal</Pro_qty>
                      <Pro_umed>int</Pro_umed>
                      <Pro_precio_uni>decimal</Pro_precio_uni>
                      <Pro_bonificacion>decimal</Pro_bonificacion>
                      <Pro_total_item>decimal</Pro_total_item>
                   </Item>
                 </Items>
                 <Opcionales>
                    <Opcional>
                      <Id>string</Id>
                      <Valor>string</Valor>
                    </Opcional>
                 </Opcionales>
                 <Fecha_pago>string</Fecha_pago>
                 <Actividades>
                    <Actividad>
                      <Id>Long</Id>
                    </Actividad>
                 </Actividades>
               </Cmp>
             </FEXAuthorize>
           </soap:Body>
         </soap:Envelope>


Dónde:
        Campo                                    Detalle                               Obligatorio
Auth                  Información de la autenticación. Contiene los datos de Token,         S
                      Sign , Cuit e Id
Token                 Token devuelto por el WSAA                                           S
Sign                  Sign devuelto por el WSAA                                            S
Cuit                  Cuit contribuyente (Representado o Emisora)                          S


        Campo                                     Detalle                              Obligatorio
Cmp                   Información de la factura de ingreso. Contiene los datos de la        S
                      cabecera del comprobante, ítems ( Items), permisos de em-
                      barque (Permisos) y comprobantes asociados (Cmps_asoc)
Permisos              Información de documentos aduaneros relacionados                     N
Cmps_asoc             Información de comprobantes de facturación asociados al              N
                      comprobante solicitado (Factura o Nota de débito contra Nota
                      de crédito solicitada o Remito)
Items                 Información de los ítems que componen el documento a au-             S
                      torizar

Cmp: La cabecera del comprobante está compuesta por los siguientes campos:


         Campo                Tipo                          Detalle                    Obligatorio
Id                       Long (N15)      Identificador del requerimiento                    S
Cbte_Tipo                Short(N2)       Tipo de comprobante. Consultar método              S
                                         FEXGetPARAM_Cbte_Tipo
                                         Valores permitidos 19,20,21
Fecha_cbte               String(C8)      Fecha de comprobante (yyyymmdd)                    N
Punto_vta                Int (N5)        Punto de venta del tipo “Comprobantes de           S
                                         Exportación - Web Services” (Código
                                         FEEWS)
                                         Consultar Método
                                         FEXGetPARAM_PtoVenta.
                                         Valores permitidos: desde 00001 hasta


                                                                                                Página 13 de 59

---

<!-- page 14 -->

Especificaciones técnicas de Servicios Web -WSFEXV1
          Campo               Tipo                          Detalle                       Obligatorio
                                         99998
Cbte_nro                 Long (N8)       Número del comprobante que se solicita au-           S
                                         torización.
                                         Valores permitidos: desde 00000001 hasta
                                         99999999
Tipo_expo                Int (N1)        Tipo de exportación . Consultar método               S
                                         FEXGetPARAM_Tipo_Expo
                                         Valores permitidos: 1,2, 4
                                                  1= Exportación definitiva de bienes
                                                  2= Servicios
                                                  4= Otros
Permiso_existente        String(C1)      Indica si se posee documento aduanero de             S
                                         exportación (permiso de embarque). Posi-
                                         bles Valores: S, N, NULL (vacío)

Dst_cmp                  Double(N3)      País de destino del comprobante. Consul-             S
                                         tar método FEXGetPARAM_DST_pais para
                                         código de países.
Cliente                  String (C200)   Apellido y Nombre o Razón Social del com-            S
                                         prador.
Cuit_pais_cliente        Long (N11)      CUIT del país destino/Contribuyente. Con-            N
                                         sultar método FEXGetPARAM_DST_CUIT
                                         para valores de cuit de países.
                                         No es obligatorio si se ingresó valor en el
                                         campo ID_impositivo
Domicilio_cliente        String          Domicilio comercial cliente.                         S
                         (C300)
ID_impositivo            String          Clave de identificación tributaria del compra-       N
                         (C50)           dor . No es obligatorio si se ingresó valor en
                                         el campo Cuit_pais_cliente
Moneda_ID                String(C3)      Código de moneda. Consultar método FEX-              S
                                         GetPARAM_MON para valores permitidos.
Moneda_Ctz               Decimal(N4,6    Cotización moneda. De informar el campo,             N
                         )               el mismo no puede quedar vacío.
                                         Consultar método FEXGetPARAM_Ctz.
CanMisMonExt             String (1)    Marca que identifica si el comprobante se              N
                                       cancela en misma moneda del comprobante
                                       (moneda extranjera). Valores posibles S o
                                       N.
Obs_comerciales          String(C4000) Observaciones comerciales                              N
Imp_total                Decimal(N13, Importe total                                           S
                         2)
Obs                      String(C1000) Observaciones                                          N
Forma_pago               String(C50)   Descripción de forma de pago                           N
Incoterms                String(C3)    Incoterms – Cláusula de Venta. Consultar               N
                                       método FEXGetPARAM_Incoterms.
Incoterms_Ds             String(C20)   Información complementaria del incoterm                N
Idioma_cbte              String(C1)    Se deberá indicar en que idioma se hará el             S
                                       documento. Consultar Método FEXGET_-
                                       PARAM_IDIOMAS.
                                       Valores posibles: 1,2,3
                                                 1:Español
                                                 2: Inglés
                                                 3: Portugués
Permisos                 Permiso         Detalle de permisos de embarque y destinos           N
                                         de la mercadería.
                                         Se puede validar mediante el método:
                                         FEXCheck_Permiso
Cmps_asoc                Cmp_asoc        Detalles de comprobantes asociados.                  N
Items                    Item            Detalle de los ítems del comprobante                 S
Opcionales               Opcional        Detalle de los datos opcionales                      N
Fecha_pago               String(C8)      Fecha de pago (yyyymmdd)                             N
Actividades              Actividad       Array para informar las actividades                  N

                                                                                                  Página 14 de 59

---

<!-- page 15 -->

Especificaciones técnicas de Servicios Web -WSFEXV1
          Campo               Tipo                           Detalle                Obligatorio
                                        asociadas a un comprobante.


Permisos: detalle de los permisos de embarque y destinos de las mercaderías:
          Campo               Tipo                           Detalle                Obligatorio
Id_permisos              String (C16)   Código de despacho – Permiso de Em-              N
                                        barque

Dst_merc                 Int(N3)        País de destino de la mercadería. Ver mé-        N
                                        todo FEXGetPARAM_DST_pais para valo-
                                        res posibles


Cmps_asoc: detalle de los comprobantes relacionados con el comprobante que se solicita
autorizar.
          Campo               Tipo                           Detalle                Obligatorio
Cbte_tipo                Short(N3)      Código de tipo de comprobante. Consultar         N
                                        método FEXGetPARAM_Cbte_Tipo
Cbte_punto_vta           Int(N5)        Punto de venta                                   N
Cbte_nro                 Long(N8)       Número de comprobante                            N
Cbte_cuit                Long(N11)      CUIT que generó el comprobante                   N


Items: el detalle de los ítems del comprobante está compuesto por los siguientes campos:
          Campo               Tipo                           Detalle                Obligatorio
Pro_codigo               String (C50)   Código de producto                               N
Pro_ds                   String         Descripción de producto                          S
                         (C4000)
Pro_qty                  Decimal        Cantidad                                         N
                         (N12,6)
Pro_umed                 Int(N2)        Unidad de medida. Consultar método               S
                                        FEXGetPARAM_UMed para valores per-
                                        mitidos
Pro_precio_uni           Decimal        Precio unitario                                  N
                         (N12,6)
Pro_bonificacion         Decimal        Bonificación sobre el ítem                       N
                         (N12,6)
Pro_total_item           Decimal        Importe total ítem                               S
                         (N13,2)


Opcionales: Campos auxiliares (array). Adicionales por R.G.
Si el comprobante que intenta autorizar corresponde a un comprobante de exportación simple
según Resolución General Conjunta 4458/2019 deberá incluir un array de opcionales con
registros como el siguiente ejemplo:
       <ar:Opcionales>
                 <ar:Opcional>
                       <ar:Id>2401</ar:Id>
                       <ar:Valor>99999999999</ar:Valor>               Documento    de       exportación
       Simplificada
                 </ar:Opcional>
                 <ar:Opcional>
                       <ar:Id>2402</ar:Id>
                       <ar:Valor>9999999999999.99</ar:Valor>  Monto FOB
                 </ar:Opcional>


                                                                                             Página 15 de 59

---

<!-- page 16 -->

Especificaciones técnicas de Servicios Web -WSFEXV1
         </ar:Opcionales>
Importante: Recuerde que si emite notas de crédito o débito con monto FOB en 0 (cero) la cuenta
corriente del titular de la mercadería no se ve afectada.


Opcional: datos opcionales del comprobante. Está compuesto por los siguientes campos:
         Campo                 Tipo                       Detalle                    Obligatorio
Id                       String (4)      Identificador de dato opcional                  S
Valor                    String (250)    Valor que acompaña al identificador.            S

Actividad: Detalle de la actividad relacionada con las actividades (array) que se indican en el
comprobante a autorizar.
   Campo            Tipo                         Detalle                    Obligatorio
                                      Código    actividad según          método
 Id              Long (6)                                                               S
                                      FEXGetPARAM_Actividades


2.1.4    Mensaje de respuesta
Retorna la información del comprobante de ingreso agregándole el CAE otorgado. Ante cualquier
anomalía se retorna un código de error cancelando la ejecución del WS.

         <?xml version="1.0" encoding="utf-8"?>
         <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-
         instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"
         xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
           <soap:Body>
             <FEXAuthorizeResponse xmlns="http://ar.gov.afip.dif.fexv1/">
               <FEXAuthorizeResult>
                 <FEXResultAuth>
                   <Id>long</Id>
                   <Cuit>long</Cuit>
                   <Cae>string</Cae>
                   <Cbte_Tipo>short</Cbte_Tipo>
                   <Punto_vta>int</Punto_vta>
                   <Cbte_nro>long</Cbte_nro>
                   <Fch_venc_Cae>string</Fch_venc_Cae>
                   <Fch_cbte>string</Fch_cbte>
                   <Resultado>string</Resultado>
                   <Reproceso>string</Reproceso>
                   <Motivos_Obs>string</Motivos_Obs>
                 </FEXResultAuth>
                 <FEXErr>
                   <ErrCode>int</ErrCode>
                   <ErrMsg>string</ErrMsg>
                 </FEXErr>
                 <FEXEvents>
                   <EventCode>int</EventCode>
                   <EventMsg>string</EventMsg>
                 </FEXEvents>
               </FEXAuthorizeResult>
             </FEXAuthorizeResponse>
         </soap:Body> </soap:Envelope>


Dónde:
       Campo                                          Detalle                         Obligatorio
FEXAuthorizeResult          Información del comprobante de ingreso, conteniendo el         S
                            CAE otorgado. Contiene los datos de FEXResultAuth ,
                            FEXErr y FEXEvents
FEXResultAuth               Información del resultado del proceso de autorización            S
FEXErr                      Información del error producido (0 – OK )                        S


                                                                                             Página 16 de 59

---

<!-- page 17 -->

Especificaciones técnicas de Servicios Web -WSFEXV1
       Campo                                         Detalle                            Obligatorio
FEXEvents                   Información de eventos programados (mantenimiento, etc)          S
                            (0 – OK )

FEXResultAuth: el resultado del proceso del pedido de autorización tiene los siguientes campos:
     Campo               Tipo                              Detalle                      Obligatorio
Id                  Long           Identificador del requerimiento                           S
Cuit                Long(N11)      Cuit del contribuyente                                    S
Cbte_Tipo           Short(N2)      Tipo de comprobante                                       S
Punto_vta           Int (N5)       Punto de venta                                            S
Cbte_nro            Long (N8)      Número del comprobante que se solicita autoriza-          S
                                   ción.

Cae                 String(C14)    CAE                                                        S
Fch_venc_Cae        String(C8)     Fecha de vencimiento del CAE                               S
Fch_cbte            String(C8)     Fecha de comprobante                                       S
Resultado           String(C1)     Resultado                                                  S
Reproceso           String(C1)     Indica si es un reproceso “S” o “N”                        S
Motivos_Obs         String(C40)    Observaciones, motivo de rechazo según tabla de            S
                                   motivos



2.1.5   Validaciones de cabecera y errores
Los siguientes controles se realizan en el WS.
                                          Código
    Descripción de la validación                                    Mensaje de error
                                          de error
Verificación de Token y Firma              1000       Usuario no autorizado       a realizar esta
                                                      operación
Cuit solicitante se encuentra entre sus     1001      Cuit solicitante no se encuentra entre sus
representados                                         representados
Cuit solicitante sea valida                 1002      Debe ser un valor numerico mayor a 0.
Identificador del requerimiento sea         1014      Debe ser un valor numerico mayor o igual a 0.
válido.


2.1.6   Validaciones de negocio y errores
Los siguientes controles se realizan en el WS.
Validaciones a realizar en la cabecera del comprobante. <Cmp>…</Cmp>
                          Código
        Campo/s             de                           Descripción de la validación
                           Error
Fecha_cbte                1500      Nulo, o comprendido entre N-5 y N+5 siendo N la Fecha de envío.

                                    Para el caso de comprobantes de servicios de exportación, la fecha de
                                    emisión del comprobante no puede ser posterior al mes en curso según
                                    normativa vigente

Punto_vta                 1510      Valor comprendido entre 1 – 99998 y dado de alta como punto de
                                    venta “Comprobantes de Exportación - Web Services” (Código FEEWS)
                                    Consultar método: FEXGetPARAM_PtoVenta
Cbte_nro                  1520      Comprendido entre 1 y 99999999.
Cbte_Tipo                 1530      Los posibles tipo de comprobantes son: 19, 20, 21
                                             19 – Factura de Exportación “E”
                                             20 – Nota de Débito por operaciones con el Exterior
                                             21 – Nota de Crédito por operaciones con el Exterior
                                    Ver método FEXGetPARAM_Cbte_Tipo
Fecha_cbte                1535      Verifica que el comprobante ingresado corresponde en secuencia al


                                                                                              Página 17 de 59

---

<!-- page 18 -->

Especificaciones técnicas de Servicios Web -WSFEXV1
                         Código
       Campo/s             de                            Descripción de la validación
                          Error
Punto_vta                         próximo inmediato a autorizar.
Cbte_nro
Cbte_Tipo
Tipo_expo                1540     Deberá ser algunos de los valores permitidos.
                                  Valores Permitidos: 1, 2, 4
                                           1= Exportación definitiva de bienes
                                           2= Servicios
                                           4= Otros
                                  Ver método FEXGetPARAM_Tipo_Expo
Permiso_existente        1550     Valores posibles: S, N o “vacío”
                                      “S” si ya se dispone del despacho de exportación.
                                      “N” si aún no se dispone del despacho de exportación.
                                  “vacío” si el campo Cbte_Tipo es 20 ó 21 o si Cbte_Tipo es igual a 19 y
                                  el campo Tipo_expo es igual a 2 ó 4.

Dst_cmp                  1560     Obligatorio. Deberá ser algunos de los valores permitidos. Ver método
                                  FEXGetPARAM_DST_pais
Cuit_pais_cliente        1570     Deberá ser algunos de los valores permitidos. Ver método FEXGetPA-
                                  RAM_DST_CUIT
ID_impositivo / Cuit_-   1580     Se deberá consignar al menos un campo.
pais_cliente
Moneda_id                1590     Deberá ser algunos de los valores permitidos. Ver método FEXGetPA-
                                  RAM_MON.
                                  Para el caso de estar autorizando comprobantes de Servicio (Tipo_ex-
                                  po=2) se deben informar solo monedas que tengan cotización al cierre
                                  del día hábil anterior (Para este caso ver método FEXGetPARAM_MO-
                                  N_CON_COTIZACION).
Moneda_ctz               1600     Deberá ser mayor a 0, hasta 4 enteros y 6 decimales
Moneda_Id                1601     Moneda_ctz deberá ser igual a 1 cuando de indique Moneda_Id = PES
/Moneda_ctz
Moneda_ctz               1602     El campo Moneda_ctz es obligatorio si no informa el campo
                                  CanMisMonExt con el valor S, y debe ser mayor a 0
CanMisMonExt             1603     Si informa el campo CanMisMonExt, los valores posibles son S o N y no
                                  debe quedar vacío.
Moneda_Id                1604     Si informa el campo MonCotiz, el mismo no podrá superar en 1 a la
/Moneda_ctz                       cotización oficial. Ver Método FEXGetPARAM_Ctz
Moneda_Id /              1605     Si informa Tipo Cbte 19 y MonID = PES, o Tipo Cbte 20 y 21 el campo
CanMisMonExt                      CanMisMonExt no debe informarse
Imp_total                1610     Deberá ser mayor igual a cero e igual a la suma de los campos
                                  Item.Pro_total_item
                                  Error relativo porcentual deberá ser <= 0.01% o el error absoluto <=0.01
                                  * cantidad de ítems ingresados
Forma_pago               1620     Obligatorio si el tipo de comprobantes es 19
Idioma_cbte              1630     Obligatorio. Deberá ser algunos de los valores permitidos.
                                  Valores posibles: 1, 2, 3
                                          1: Español
                                          2: Inglés
                                          3: Portugués

                                  Ver método FEXGetPARAM_Idiomas
Incoterms                1640     Obligatorio en el caso que el tipo de comprobante sea igual a 19 y tipo
                                  de operación sea igual a 1 (Productos). Para el resto de los casos es
                                  opcional.

                                  Para obtener los valores permitidos consultar el método FEXGetPARA-
                                  M_Incoterms
Incoterms_Ds             1641     Si se ingresó un valor, el campo Incoterms no puede estar vacío.
Incoterms_Ds             1642     Longitud máxima es de 20 caracteres.
Cliente                  1650     Campo Obligatorio, no podrá estar vacío.
Cliente                  1651     Longitud máxima es de 200 caracteres
Domicilio_cliente        1660     Campo Obligatorio, no podrá estar vacío


                                                                                              Página 18 de 59

---

<!-- page 19 -->

Especificaciones técnicas de Servicios Web -WSFEXV1
                        Código
      Campo/s             de                            Descripción de la validación
                         Error
Domicilio_cliente       1661       Longitud máxima es de 300 caracteres
Obs/Obs_comerciales     1665       Opcionales. El campo Obs la longitud máxima es 1000 y para el campo
                                   Obs_comerciales la longitud máxima es 4000
Moneda_Id /Mone-        1667       Si Moneda_Id <> PES, el campo Moneda_ctz no puede ser superior en
da_ctz                             un 400% ni inferior al 2% de la cotización oficial (ver método FEXGetPA-
                                   RAM_Ctz)
<Auth><Cuit>            1668       Si el tipo de exportación corresponde al concepto (Tipo_expo=1) Expor-
<Cmp><Tipo_expo>                   tación definitiva de bienes. Deberá estar registrado como exportador.
Moneda_ctz / Mone-      2053       Para el caso de Factura, si está autorizando un comprobante de Servi-
da_ctz                             cio (Tipo_expo=2) y la moneda es diferente de PES, la cotización debe
                                   ser la del día hábil anterior (divisa vendedor) de la fecha de emisión de
                                   la factura. En caso que la solicitud sea con fecha anterior a la de la fac-
                                   tura, deberá ser igual a la del día hábil anterior de la solicitud.

                                   Para el caso de Nota de Débito o Nota de Crédito de Servicio (Tipo_ex-
                                   po=2), la cotización informada debe ser la misma que la del comproban-
                                   te asociado.

<Cmp><Fecha_pago>       1671       Si informa fecha de pago <Cmp><Fecha_pago> debe tener formato váli-
                                   do YYYYMMDD.
<Cmp><Cbte_Tipo>/       1672       Para comprobantes del tipo “19 - Facturas de Exportación” donde el tipo
<Cmp><Tipo_expo>/                  de exportación es “2 – Servicios / 4 - Otros” la fecha de pago
<Cmp><Fecha_pago>                  <Cmp><Fecha_pago> es obligatoria.
<Cmp><Cbte_Tipo>/       1673       Para comprobantes que no son tipo “19 - Facturas de Exportación” la fe-
<Cmp><Tipo_expo>/                  cha de pago <Cmp><Fecha_pago> no debe informarse.
<Cmp><Fecha_pago>
<Cmp><Cbte_Tipo>/       1674       Para comprobantes del tipo “19 - Facturas de Exportación” donde el tipo
<Cmp><Tipo_expo>/                  de exportación es “2 – Servicios / 4 - Otros”, la fecha de pago debe ser
<Cmp><Fecha_pago>/                 igual o posterior a la fecha de emisión del comprobante.
<Cmp>< Fecha_cbte>




Validaciones a realizar en los comprobantes asociados <Cmps_asoc>…</ Cmps_asoc >


Se deberá informar el/los comprobante/s asociados solamente si el comprobante que se está
autorizando corresponde a una Nota de Débito o Nota de Crédito por operaciones con el exterior
E, es decir que el campo Cmp.Cbte_Tipo sea igual a 20 ó 21 o bien, si el comprobante es una
Factura de exportación Cmp.Cbte_Tipo igual a 19 y se informan remitos de Tabaco como
comprobantes asociados Cmp_asoc .Cbte_tipo igual a 89, 88, 91, 993, 994.
La presente grilla identifica las cantidades de comprobantes que se pueden asociar según el tipo
de comprobante a autorizar

      Cmp.Cbte_Tipo        Cmp_asoc.Cbte_tipo
  (tipo de comprobante     (tipos de compro-  Cantidad
                                                                            Validación
  que se está autorizan-   bantes que se pue- máxima
            do)            den asociar)
                                                               Que exista el comprobante (solo si el
                                                                punto de venta es electrónico para
          20 ó 21                19, 20 ó 21           1        Tipo_expo = 1 o 4) Para los casos
                                                               que Tipo_expo =2 debe existir y ser
                                                                           electrónico.
                                                               Que exista el remito en los registros
        19, 20 ó 21        89, 88, 91, 993, 994     sin tope
                                                                      de la Administración.


De informarse deberá cumplir las siguientes validaciones:




                                                                                                 Página 19 de 59

---

<!-- page 20 -->

Especificaciones técnicas de Servicios Web -WSFEXV1
                        Código
      Campo/s             de                          Descripción de la validación
                         Error
Cbte_tipo /Cbte_pun-     1670    Si alguno de estos campos no está vació entonces ninguno de estos
to_vta / Cbte_nro                debe estar vacío. Es decir si se informó el tipo de comprobante
                                 (Cbte_tipo) entonces se deben informar los campos punto de venta y
                                 número de comprobante (Cbte_punto_vta / Cbte_nro)
Cbte_tipo                1680    Los posibles tipo de comprobantes son: 19, 20, 21, 88, 89
                                 19 – Factura de Exportación “E”
                                 20 – Nota de Débito por operaciones con el Exterior
                                 21 – Nota de Crédito por operaciones con el Exterior
                                 88 -Remito Electrónico de Tabaco Acondicionado
                                 89 - Resumen de Datos de Exportación de Tabaco Acondicionado
                                 91 - Remito R
                                 993 - Remito Electrónico Harinero - Automotor
                                 994 - Remito Electrónico Harinero – Ferroviario
                                 Ver método FEXGetPARAM_Cbte_Tipo
Cbte_punto_vta           1690    De informarse deberá estar comprendido entre 1 – 99998.
Cbte_nro                 1700    De informarse podrá tomar los valores desde 1 hasta 999999999
Cbte_tipo /Cbte_pun-     1749    Si el tipo de comprobante asociado (Cbte_tipo) es igual a 19, 20 o 21 y
to_vta                           el punto de venta informado es electrónico, el punto de venta deberá
 / Cbte_nro                      corresponder a alguno de los tipos de puntos de venta habilitados para
                                 Comprobantes de Exportación. Si se cumple, el tipo y número de
                                 comprobante informado deberá estar autorizado.
Cmps_asoc                1754    No se puede informar más de 1 comprobante asociado, excepto que los
                                 mismos sean 88 u 89.
Cmps_asoc                1755    No se pueden informar comprobantes asociados cuando el tipo de
                                 comprobante a autorizar es 19 (Factura E), excepto que los mismos
                                 sean del tipo 89, 88, 91, 993, 994
Cmps_asoc                1818    Si el tipo de comprobante asociado Cbte_tipo es igual 89, 88, 993, o
                                 994, entonces éste deberá estar registrado.
Cmps_asoc                1819    Si el tipo de comprobante asociado Cbte_tipo es igual a 89, 88, 993,
                                 o 994, y el emisor (Cbte_cuit) es distinto al emisor del comprobante
                                 que se solicita autorización (<Cuit>) entonces, el comprobante asociado
                                 deberá estar registrado como confirmado.
Cmps_asoc                1820    Si envía Cmps_asoc, Cmp_asoc es obligatorio
Cmps_asoc                1821    Si informa comprobante asociado y sus códigos (Cbte_tipo) son 89, 88,
                                 993, o 994, entonces el receptor del comprobante a autorizar debe ser
                                 igual al receptor del comprobante asociado.
Cmps_asoc                1822    Si informa comprobante asociados y sus códigos (Cbte_tipo)
                                 corresponden a 89, 88, 993, o 994, los mismos no deben encontrarse
                                 asociado a otro comprobante.
Cmps_asoc                1823    Si informa comprobante asociados y sus códigos (Cbte_tipo)
                                 corresponden a 89, 88, 993, o 994, tanto el comprobante a autorizar
                                 como el comprobante asociado deben corresponder a comprobantes del
                                 tipo exportación.
Cmps_asoc                2040    Si esta autorizando una N.D. de Servicio (Tipo_expo=2), no se puede
                                 asociar mas de una Factura como comprobante asociado
                                 (Cmp.Cmps_asoc).
Cmps_asoc                2041    Si esta autorizando una N.D. de Servicio (Tipo_expo=2), el comprobante
                                 asociado no puede ser del tipo Nota de Debito (Cmp.Cmps_asoc).
Cmps_asoc                2042    Si esta autorizando una N.D. de Servicio (Tipo_expo=2), el comprobante
                                 asociado no puede ser del tipo Nota de Credito (Cmp.Cmps_asoc).
Cmps_asoc                2043    Si esta autorizando una N.C. de Servicio (Tipo_expo=2), no se puede
                                 asociar mas de una Factura como comprobante asociado
                                 (Cmp.Cmps_asoc).
Cmps_asoc                2044    Si esta autorizando una N.C. de Servicio (Tipo_expo=2), no se puede
                                 asociar mas de una Nota de Debito como comprobante asociado
                                 (Cmp.Cmps_asoc).
Cmps_asoc                2045    Si esta autorizando una N.C. de Servicio (Tipo_expo=2), el comprobante
                                 asociado no puede ser del tipo Nota de Credito (Cmp.Cmps_asoc).



                                                                                            Página 20 de 59

---

<!-- page 21 -->

Especificaciones técnicas de Servicios Web -WSFEXV1
                        Código
      Campo/s             de                           Descripción de la validación
                         Error
Cmps_asoc                2046      Si esta autorizando una N.C. de Servicio (Tipo_expo=2), no puede
                                   ingresar como comprobantes asociados una Factura mas una Nota de
                                   Debito (Cmp.Cmps_asoc). Ingrese uno y solo uno de los tipos de
                                   comprobantes.
Cmps_asoc                 2047     Si esta autorizando una N.D. o N.C. comprobante de Servicio (Tipo=2),
                                   el campo Cmp.Cmps_asoc es de caracter obligatorio.
Cmps_asoc                 2048     Si esta autorizando un comprobante de Servicio (Tipo_expo=2), el
                                   comprobante asociado debe ser electrónico y existir en las bases del
                                   organismo (ARCA).
Cmps_asoc                 2049     Si esta autorizando un comprobante de Servicio (Tipo_expo=2), el
                                   comprobante asociado tambien debe ser de Servicio.

Cmps_asoc                 2050     Si esta autorizando un comprobante de Servicio (Tipo_expo=2), el pais
                                   de destino debe ser el mismo que el comprobante asociado.
Cmps_asoc                 2051     Si esta autorizando un comprobante de Servicio (Tipo_expo=2), la
                                   moneda debe ser la misma que el comprobante asociado o emitirse en
                                   PESOS.
Cmps_asoc                 2052     Si esta autorizando un comprobante de Servicio (Tipo_expo=2), la fecha
                                   del comprobante debe ser igual o posterior a la fecha del comprobante
                                   asociado.
Cmps_asoc                 2055     Para comprobante de Servicio (Tipo_expo=2), la Nota de Debito asocia-
                                   da que informa debe tener una FACTURA (Cbte_tipo=19) de servicio
                                   (Tipo_expo=2) asociada.




Validaciones sobre el permiso de embarque <Permisos>…</Permisos>


Los datos correspondientes a permiso deberán ser informados o no según la siguiente tabla:



                                                                       <Permisos>
                 Tipo_expo       Cbte_Tipo   Permiso_existente
                                                                   Id_permiso / Dest_-
                                                                          merc
                     1              19               No                   Vacío
                     1              19               Si                 Obligatorio
                     1              20              Vacío                Opcional
                     1              21              Vacío                Opcional
                    2ó4             19              Vacío                 Vacío
                    2ó4             20              Vacío                 Vacío
                    2ó4             21              Vacío                 Vacío


Los errores de validación del cuadro anterior se informaran como error 1720 con su texto
descriptivo.
                  Código de
  Campo/s                                              Descripción de la validación
                    Error
                                   - Obligatorio para Tipo_expo = 1 Cmp.Cbte_Tipo = 19 y
                                   Cmp.Permiso_existente = “S”
 Permisos /                        - Enviado. El mismo no debe enviarse cuando Cmp.Permiso_existente =
                     1720
 Id_permiso                        “N"
                                   - Obligatorio (tag Permisos), Si envía <Permisos>, <Permiso> es
                                   obligatorio.



                                                                                             Página 21 de 59

---

<!-- page 22 -->

Especificaciones técnicas de Servicios Web -WSFEXV1




De informarse deberá cumplir las siguientes validaciones:
                        Código
      Campo/s             de                          Descripción de la validación
                         Error
Id_permiso / Dst_merc    1730    Si se informó el campo Id_permiso deberá informase el campo
                                 Dst_merc, como así también si se informó el campo Dst_merc deberá
                                 informarse el campo Id_permiso.
Tipo_expo / Permisos     1736    No es posible informar estos campos con tipo_expo = 2 ó 4.
Id_permiso               1740    Deberá ser un permiso válido, formato 99999AAXX999999A (donde XX
                                 podrán ser números o letras).
                                 Ver método FEXCHECK_PERMISO.
                                 Importante: la combinación Id_permiso y Dst_merc no pueden repetirse
                                 dentro del array de <Permisos>.
Dst_merc                 1750    Para los posibles valores consultar método FEXGetPARAM_DST_pais.
                                 El destino de la mercadería debe corresponder a un país del permiso de
                                 embarque (código despacho) asignado al campo Id_permiso.
                                 Se puede validar la existencia de un permiso de embarque / destino de
                                 la mercadería mediante el método: FEXCHECK_PERMISO




Validaciones sobre los Ítems del comprobante <Ítems>… </Ítems>
                        Código
      Campo/s             de                          Descripción de la validación
                         Error
Pro_codigo               1760    No podrá superar longitud de 50 caracteres
Pro_ds                   1770    Campo obligatorio. No podrá exceder los 4000 caracteres de longitud.
Pro_qty/ Pro_umed/       1775    Si Pro_umed es igual a 0, 97 ó 99 deberán informar Item.Pro_qty,
Pro_precio_uni/                  Item.Pro_precio_uni y Pro_bonificacion igual a 0 ó no informarse.
Pro_bonificacion
Pro_qty                  1780    Es obligatorio si se informa el precio unitario (Pro_precio_uni) o si
                                 Pro_umed es distinto a 0, 97 y 99.
                                 De ingresarse valor deberá ser mayor a cero.
Pro_qty                  1813    Valor máximo permitido 12 enteros y 6 decimales.
Pro_umed                 1790    Valores posible Ver Método FEXGetPARAM_UMed
Pro_precio_uni           1800    Es obligatorio si se informa la cantidad (Pro_qty) o si Pro_umed es
                                 distinto a 0, 97 y 99.
                                 De ingresarse valor deberá ser mayor o igual a cero.
Pro_precio_uni           1814    Valor máximo permitido 12 enteros y 6 decimales.
Pro_total_item           1810    Obligatorio.
                                 Si Pro_umed es distinto a 97 y 99, el valor deber ser mayor o igual a 0.
                                 Si Pro_umed = 97, sin restricción, el valor puede ser menor, igual o
                                 mayor a cero.
                                 Si Pro_umed = 99, el valor debe ser menor a 0.
Pro_total_item           1815    Si Pro_umed es distinto a 0, 97 ó 99 deberá ser igual a
                                 <Pro_precio_uni> * <Pro_qty> - Pro_bonificacion
                                 Error relativo porcentual deberá ser <= 0.01% o el error absoluto <=0.01
Pro_total_item           1816    Valor máximo permitido 13 enteros y 2 decimales.
Pro_bonificacion         1811    Si Pro_umed es distinto de 97, 99 y 0, entonces el valor informado para
                                 Pro_bonificacion debe ser mayor o igual a 0
Pro_bonificacion         1812    Si es mayor a 0 debe ser menor o igual a Pro_precio_uni * Pro_qty.
Pro_bonificacion         1817    Valor máximo permitido 12 enteros y 6 decimales.
Items                    1666    La estructura <Items> es inválida, ya sea porque no se ingresó, o bien
                                 porque posee 0 ítems, o bien porque supera los 9999 ítems.


                                                                                             Página 22 de 59

---

<!-- page 23 -->

Especificaciones técnicas de Servicios Web -WSFEXV1




Validaciones sobre los Opcionales del comprobante <Opcionales>… </Opcionales>


                           Código
        Campo/s              de                         Descripción de la validación
                            Error
<Opcionales>/<Opcional>     2001     Si envía opcionales, opcional es obligatorio informarlo.
<Opcionales>/<Opcional>     2002     Si envía opcionales, opcional es obligatorio y no debe estar vacío.
<Opcionales>/               2003     El campo Id en Opcionales es obligatorio y debe ser alguno de los
<Opcional><Id>                       devueltos por el método FEXGetPARAM_Opcionales.
<Opcionales>/               2004     El campo Id en Opcionales es obligatorio y no debe repetirse.
<Opcional><Id>
<Opcionales>/               2005     Si envía opcionales con el identificador 2401, el campo valor es
<Opcional><Id>                       obligatorio informarlo.
<Opcional><Valor>
<Opcionales>/               2006     Si envía opcionales con el identificador 2401, el campo valor debe
<Opcional><Id>                       contener el documento de exportación. Alfanumérico de 11
<Opcional><Valor>                    caracteres
<Opcionales>/               2007     Si envía opcionales con el identificador 2402, el campo valor es
<Opcional><Id>                       obligatorio informarlo.
<Opcional><Valor>
<Opcionales>/               2008     Si envía opcionales con el identificador 2402, el campo valor debe
<Opcional><Id>                       representar al monto FOB. Se espera un numérico de 13 valores
<Opcional><Valor>                    enteros y 2 decimales. Separador de decimales usar el punto.
<Cbte_Tipo>/                2010     Si informa opcionales para el régimen de exportación simplificada es
<Opcionales>/                        obligatorio informar:
<Opcional>                           - para “19 – Facturas” el documento de exportación simplificada y
                                          el monto FOB con valor mayor o igual a 0.

                                     -   para “20 - Nota de Débito” y “21 – Nota de Crédito” solo informar
                                         el monto FOB.

<Tipo_expo>/                2011     Si informa opcionales para el régimen de exportación simplificada,
<Opcionales>                         solo se encuentra habilitada para el tipo de exportación 1 –
                                     PRODUCTO.
<Opcionales>/               2016     Si envía opcionales para el régimen de exportación simplificada, solo
<Moneda_Id>                          se permite moneda en DOLARES, Moneda_Id = DOL.

<Opcionales>                2020     Si envía opcionales para el régimen de exportación simplificada e
<Opcional><Id>                       informa el monto FOB, el mismo no puede superar el monto máximo
<Opcional><Valor>                    habilitado a informar por comprobante.
<Opcionales>                2021     Si envía opcionales para el régimen de exportación simplificada e
<Opcional><Id>                       informa el monto FOB, el mismo no puede superar el monto total del
<Opcional><Valor>/                   comprobante.
<Cmp><Imp_total>
<Opcionales>                2022     Si envía opcionales para el régimen de exportación simplificada e
<Opcional><Id>                       informa el monto FOB y el tipo de comprobante es Factura, el valor
<Opcional><Valor>/                   informado debe ser igual al monto FOB del Permiso de Embarque.
<Cmp><Cbte_Tipo>

<Opcionales>                2023     Si envía opcionales para el régimen de exportación simplificada,
<Opcional><Id>                       informa el monto FOB y el tipo de comprobante es Nota de Crédito o
<Opcional><Valor>/                   Débito, el valor informado debe ser menor o igual al monto FOB
<Cmp><Cbte_Tipo>                     original informado junto al Permiso de Embarque.

<Opcionales>                2026     Si envía opcionales para el régimen de exportación simplificada,
<Opcional><Id>                       evaluar que el exportador tenga saldo disponible acorde con el tipo
<Opcional><Valor>/                   de operación para el periodo identificado en la fecha del
<Cmp><Fecha_cbte>                    comprobante.
<Auth><Cuit>                2027     Si el comprobante es del tipo exportación simplificada, el emisor del
                                     comprobante debe encontrarse habilitado.


                                                                                              Página 23 de 59

---

<!-- page 24 -->

Especificaciones técnicas de Servicios Web -WSFEXV1
                           Código
        Campo/s              de                           Descripción de la validación
                            Error
<Auth><Cuit>/               2028       Si el comprobante es Nota de Crédito o Débito, de exportación
                                       simple, es obligatorio informar comprobantes asociados.
<Cmp><Cbte_Tipo>/

<Opcionales>
<Opcional><Id>
<Opcional><Valor>/

<Cmps_asoc>
<Auth><Cuit>/               2029       Si el comprobante es Nota de Crédito o Débito, de exportación
                                       simple, el comprobante asociado debe ser un comprobante de
<Cmp><Cbte_Tipo>/                      exportación simplificada Autorizado perteneciente al emisor.

<Opcionales>
<Opcional><Id>
<Opcional><Valor>/

<Cmps_asoc>
<Auth><Cuit>                2031       Si el tipo de comprobante asociado Cbte_tipo es distinto a 88 u 89 e
<Cmp_asoc><Cbte_tipo>                  informa el cuit del emisor del comprobante asociado (Cbte_cuit), no
<Cmp_asoc><Cbte_cuit>                  puede ser distinto al emisor del comprobante que se solicita
                                       autorización (<Cuit>).
<Cmp><Cbte_Tipo>/           2032       Si el comprobante es 20 - Nota de Débito o 21 - Nota de Crédito e
<Cmp_asoc>                             intenta autorizar un comprobante del tipo exportación simplificada es
<Opcionales>                           obligatorio informar comprobante asociado del tipo exportación
                                       simplificada y datos opcionales del tipo exportación simplificada.

<Opcionales>                2056       Si envía opcionales para el régimen de exportación simplificada no
<Opcional><Id>                         informar <Permios><Permiso>
<Opcional><Valor>/
<Permisos><Permiso>
<Cmp><Cbte_Tipo>/           2057       Si el comprobante es 20 - Nota de Débito o 21 - Nota de Crédito e
<Opcionales>                           intenta autorizar un comprobante del tipo exportación simplificada no
<Opcional><Id>                         informar el documento de exportación simplificada
<Opcional><Valor>
<Cmp><Cbte_Tipo>/           2058       Si el comprobante es 20 - Nota de Débito o 21 - Nota de Crédito e
<Opcionales>                           intenta autorizar un comprobante del tipo exportación simplificada es
<Opcional><Id>                         obligatorio informar el monto FOB.
<Opcional><Valor>
<Opcionales>                2059       El documento de exportación simplificado informado no se encuentra
<Opcional><Id>                         registrado o tiene diferencias con el registrado.
<Opcional><Valor>
<Opcionales>                2060       El documento de exportación simplificado informado no se encuentra
<Opcional><Id>                         registrado o tiene diferencias en el monto FOB.
<Opcional><Valor>
<Auth><Cuit>/               2061       Según los datos del comprobante asociado, no se puede autorizar el
<Cmp_asoc>/                            comprobante actual, el saldo FOB es inferior a 0 o superior al
<Opcionales>/                          disponible por comprobante.
<Opcional><Id>
<Opcional><Valor>



Validaciones sobre las actividades asociadas al comprobante <Actividades>… </Actividades>



                               Códig
         Campo/s                o de                        Descripción de la validación
                               Error
<Actividades><Actividad>       2100       Si envía estructura de Actividades, Actividad es obligatorio



                                                                                                Página 24 de 59

---

<!-- page 25 -->

Especificaciones técnicas de Servicios Web -WSFEXV1
                               Códig
         Campo/s                o de                    Descripción de la validación
                               Error
                                        enviarlo.
<Actividades><Actividad>       2101     Si envía estructura de Actividades, Actividad es obligatorio
<Id>                                    enviarlo y no debe estar vacío.
<Actividades><Actividad>       2102     El identificador de actividad informado tiene que ser una de
<Id>                                    las    actividades       habilitadas.  Consultar     método
                                        FEXGetPARAM_Actividades.
<Actividades><Actividad>       2103     De enviarse el tag Actividades, las actividades no deben
<Id>                                    repetirse.
<Actividades><Actividad>       2104     De enviarse actividades, las mismas no deben corresponder
<Id>                                    a distintos grupos según RG. Es decir, si informa
                                        actividades de Harina, no pueden estar combinadas con
                                        actividades de Tabaco, etc.
<Actividades><Actividad>       2105     De enviarse actividades, las mismas deben encontrarse
<Id>                                    activas para el emisor del comprobante. Ver método
                                        FEXGetPARAM_Actividades.
<Actividades><Actividad>       2106     De enviarse actividades pertenecientes al grupo de
<Id> / <Concepto>                       actividades Harineras/Tabaco, las mismas deben enviarse
                                        con comprobantes con Concepto del tipo Producto o
                                        Productos y Servicios.


<Actividades><Actividad>       2108     Si las actividades informadas corresponden a actividades
<Id>                                    Harinas, informar remito asociado 993 - Remito Electronico
                                        Harinero - Automotor o
/
<CbtesAsoc><CbteAsoc>                   994 - Remito Electronico Harinero - Ferroviario.
<Tipo>
<Actividades><Actividad>       2109     Si las actividades informadas corresponden a actividades
<Id>                                    Tabaco Acondicionado, informar remito asociado 88 -
                                        Remito Electrónico de Tabaco Acondicionado o 89 -
/
                                        Resumen de Datos de Exportación de Tabaco
<CbtesAsoc><CbteAsoc>
                                        Acondicionado
<Tipo>


<Actividades><Actividad>       2111     Si informa remito 993 - Remito Electronico Harinero -
<Id>                                    Automotor o
/                                       994 - Remito Electronico Harinero – Ferroviario, es
<CbtesAsoc><CbteAsoc>                   obligatgorio informar una actividad Harinera.
<Tipo>
<Actividades><Actividad>       2112     Si informa remito 88 - Remito Electrónico de Tabaco
<Id>                                    Acondicionado o 89 - Resumen de Datos de Exportación de
                                        Tabaco Acondicionado, es obligatorio informar una actividad
/
                                        correspondiente a Tabaco Acondicionado.
<CbtesAsoc><CbteAsoc>
<Tipo>
<Actividades><Actividad>       2113     Si informa actividades indicadas en la RG, es obligatorio
<Id>                                    informar comprobantes asociados.
/<CbtesAsoc><CbteAsoc




                                                                                           Página 25 de 59

---

<!-- page 26 -->

Especificaciones técnicas de Servicios Web -WSFEXV1



2.1.7    Otros errores


Los mensajes de error no contemplados en este documento salen por código 1014 incluyendo un
texto que explica la causa exacta del error.


2.1.8 Otras Observaciones/Rechazos


Estos errores de observación/rechazo salen en la estructura Motivos_Obs.
                             Código
                               de
         Campo/s                                          Descripción de la validación
                             Observa
                              ción
<Cuit> / <Cbte_Tipo> /         14        Si el emisor es monotributista, e informa una factura o nota
<Imp_total> /                            de débito, se valida que el importe total en pesos no exceda
<Moneda_ctz>                             el importe límite establecido para la categoría máxima de
                                         Monotributo.
                                         Por tal motivo, quedarías excluido automáticamente
                                         teniendo que solicitar el alta de los tributos (impositivos y de
                                         los recursos de la seguridad social) en el régimen general
                                         de acuerdo con la actividad.
<Cuit> / <Cbte_Tipo> /         15        Si el emisor es monotributista, e informa una factura o nota
<Imp_total> /                            de crédito, se valida que el importe total en pesos no
<Moneda_ctz>                             exceda el importe límite establecido para la categoría de
                                         Monotributo.
                                         Tenerlo en cuenta para la próxima recategorización.
<Cuit> / Punto_vta /           16        Si el comprobante fue emitido a un destino del tipo Zona
Dst_cmp                                  Franca, es necesario que exista el receptor en los padrones
                                         de ARCA
<Cuit> / <Cbte_Tipo> /         17        El importe de la nota de crédito supera el monto del
<Imp_total> /                            comprobante asociado que estás ajustando. Verificá los
<Moneda_ctz>                             montos ingresados y de tratarse de un error, tenés que
                                         efectuar el ajuste o anulación de la operación según
                                         corresponda.




                             Código
         Campo/s               de                         Descripción de la validación
                             Rechazo
<Cuit>                         21        La CUIT receptora se encuentra inactiva por haber sido
                                         incluida en la consulta de facturas apócrifas.


Los mensajes de error no contemplados en este documento salen por código 1014 incluyendo un
texto que explica la causa exacta del error.


2.1.9    Ejemplo Request 1


<?xml version="1.0" encoding="utf-8"?>
<ClsFEXRequest xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <Id >1</Id>



                                                                                            Página 26 de 59

---

<!-- page 27 -->

Especificaciones técnicas de Servicios Web -WSFEXV1
  <Fecha_cbte >20100118</Fecha_cbte>
  <Cbte_Tipo >19</Cbte_Tipo>
  <Punto_vta >2</Punto_vta>
  <Cbte_nro >1</Cbte_nro>
  <Tipo_expo >1</Tipo_expo>
  <Permiso_existente >S</Permiso_existente>
  <Permisos >
    <Permiso>
         <Id_permiso>09052EC01006154G</Id_permiso>
         <Dst_merc>203</Dst_merc>
    </Permiso>
    <Permiso>
         <Id_permiso>09052EC01006154G</Id_permiso>
         <Dst_merc>202</Dst_merc>
    </Permiso>
  </Permisos>
  <Dst_cmp >203</Dst_cmp>
  <Cliente >Joao Da Silva</Cliente>
  <Cuit_pais_cliente >50000000016</Cuit_pais_cliente>
  <Domicilio_cliente >Rua 76 km 34.5 Alagoas</Domicilio_cliente>
  <Id_impositivo >PJ54482221-l</Id_impositivo>
  <Moneda_Id >012</Moneda_Id>
  <Moneda_ctz >0.51</Moneda_ctz>
  <Obs_comerciales>Sin observaciones</Obs_comerciales>
  <Imp_total >500</Imp_total>
  <Obs></Obs>
  <Forma_pago >Contado</Forma_pago>
  <Incoterms>CIF</Incoterms>
  <Incoterms_Ds>Texto dic.</Incoterms_Ds>
  <Idioma_cbte>1</Idioma_cbte>
  <Items >
    <Item>
         <Pro_codigo>PRO1</Pro_codigo>
         <Pro_ds>Producto Tipo 1 Exportacion MERCOSUR ISO 9001</Pro_ds>
         <Pro_qty>2</Pro_qty>
         <Pro_umed>7</Pro_umed>
         <Pro_precio_uni>250</Pro_precio_uni>
         <Pro_total_item>500</Pro_total_item>
    </Item>
  </Items>
</ClsFEXRequest>



2.1.10    Ejemplo Request 2 (con comprobante asociado)

<?xml version="1.0" encoding="utf-8"?>
<ClsFEXRequest xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <Id >1</Id>
  <Fecha_cbte >20100118</Fecha_cbte>
  <Cbte_Tipo >21</Cbte_Tipo>
  <Punto_vta >2</Punto_vta>



                                                                          Página 27 de 59

---

<!-- page 28 -->

Especificaciones técnicas de Servicios Web -WSFEXV1
  <Cbte_nro >1</Cbte_nro>
  <Tipo_expo >1</Tipo_expo>
  <Permiso_existente >S</Permiso_existente>
  <Permisos >
    <Permiso>
         <Id_permiso></Id_permiso>
         <Dst_merc></Dst_merc>
    </Permiso>
  </Permisos>
  <Dst_cmp >203</Dst_cmp>
  <Cliente >Joao Da Silva</Cliente>
  <Cuit_pais_cliente >50000000016</Cuit_pais_cliente>
  <Domicilio_cliente >Rua 76 km 34.5 Alagoas</Domicilio_cliente>
  <Id_impositivo >PJ54482221-l</Id_impositivo>
  <Moneda_Id >012</Moneda_Id>
  <Moneda_ctz >0.51</Moneda_ctz>
  <Obs_comerciales>Sin observaciones</Obs_comerciales>
  <Imp_total >250</Imp_total>
  <Obs></Obs>
         <Cmps_asoc>
             <Cmp_asoc>
              <Cbte_tipo>19</Cbte_tipo>
              <Cbte_punto_vta>2</Cbte_punto_vta>
              <Cbte_nro>1</Cbte_nro>
              <Cbte_cuit>33500606989</Cbte_cuit>
             </Cmp_asoc>
         </Cmps_asoc>
  <Forma_pago >30 dias</Forma_pago>
  <Incoterms>/Incoterms>
  <Incoterms_Ds></Incoterms_Ds>
  <Idioma_cbte>1</Idioma_cbte>
  <Items >
    <Item>
         <Pro_codigo>PRO1</Pro_codigo>
         <Pro_ds>Producto Tipo 1 Exportacion MERCOSUR ISO 9001</Pro_ds>
         <Pro_qty>1</Pro_qty>
         <Pro_umed>7</Pro_umed>
         <Pro_precio_uni>250</Pro_precio_uni>
         <Pro_total_item>250</Pro_total_item>
    </Item>
  </Items>
</ClsFEXRequest>



2.1.11    Ejemplo Request 3 (con bonificación a nivel de ítem, campo Pro_bonificacion)

<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
xmlns:ar="http://ar.gov.afip.dif.fexv1/">
   <soapenv:Header/>
   <soapenv:Body>
         <ar:FEXAuthorize>
           <ar:Auth>



                                                                                         Página 28 de 59

---

<!-- page 29 -->

Especificaciones técnicas de Servicios Web -WSFEXV1
            <ar:Token>Un String</ar:Token>
            <ar:Sign>Un String</ar:Sign>
            <ar:Cuit>66666666666</ar:Cuit>
         </ar:Auth>
         <ar:Cmp>
            <ar:Id>4502</ar:Id>
            <ar:Fecha_cbte>20110102</ar:Fecha_cbte>
            <ar:Cbte_Tipo>19</ar:Cbte_Tipo>
            <ar:Punto_vta>99998</ar:Punto_vta>
            <ar:Cbte_nro>2</ar:Cbte_nro>
            <ar:Tipo_expo>1</ar:Tipo_expo>
            <ar:Permiso_existente>N</ar:Permiso_existente>
            <ar:Dst_cmp>220</ar:Dst_cmp>
            <ar:Cliente>Denominacion del Cliente</ar:Cliente>
            <ar:Cuit_pais_cliente>55000000050</ar:Cuit_pais_cliente>
            <ar:Domicilio_cliente>Domicilio del Cliente</ar:Domicilio_cliente>
            <ar:Id_impositivo>Id9999/99</ar:Id_impositivo>
            <ar:Moneda_Id>PES</ar:Moneda_Id>
            <ar:Moneda_ctz>1</ar:Moneda_ctz>
            <ar:Obs_comerciales>Texto libre 1</ar:Obs_comerciales>
            <ar:Imp_total>1209.08</ar:Imp_total>
            <ar:Obs>Texto libre 2</ar:Obs>
            <ar:Forma_pago>Efectivo</ar:Forma_pago>
            <ar:Incoterms>FOB</ar:Incoterms>
            <ar:Incoterms_Ds>Descripción Incoter</ar:Incoterms_Ds>
            <ar:Idioma_cbte>1</ar:Idioma_cbte>
             <ar:Items>
               <ar:Item>
                    <ar:Pro_codigo>Cod0001</ar:Pro_codigo>
                    <ar:Pro_ds>Descripcion del Producto</ar:Pro_ds>
                    <ar:Pro_qty>100.555444</ar:Pro_qty>
                    <ar:Pro_umed>7</ar:Pro_umed>
                    <ar:Pro_precio_uni>12.123456</ar:Pro_precio_uni>
                    <ar:Pro_bonificacion>10</ar:Pro_bonificacion>
                    <ar:Pro_total_item>1209.08</ar:Pro_total_item>
               </ar:Item>
            </ar:Items>
         </ar:Cmp>
      </ar:FEXAuthorize>
   </soapenv:Body>
</soapenv:Envelope>



2.1.12 Ejemplo Request 4 (con bonificación / descuento Global)


<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
xmlns:ar="http://ar.gov.afip.dif.fexv1/">
   <soapenv:Header/>
   <soapenv:Body>
      <ar:FEXAuthorize>
         <ar:Auth>
            <ar:Token>Un String</ar:Token>


                                                                                 Página 29 de 59

---

<!-- page 30 -->

Especificaciones técnicas de Servicios Web -WSFEXV1
            <ar:Sign>Un String</ar:Sign>
            <ar:Cuit>66666666666</ar:Cuit>
         </ar:Auth>
         <ar:Cmp>
            <ar:Id>4503</ar:Id>
            <ar:Fecha_cbte>20110102</ar:Fecha_cbte>
            <ar:Cbte_Tipo>19</ar:Cbte_Tipo>
            <ar:Punto_vta>99998</ar:Punto_vta>
            <ar:Cbte_nro>3</ar:Cbte_nro>
            <ar:Tipo_expo>1</ar:Tipo_expo>
            <ar:Permiso_existente>N</ar:Permiso_existente>
            <ar:Dst_cmp>220</ar:Dst_cmp>
            <ar:Cliente>Denominacion del Cliente</ar:Cliente>
            <ar:Cuit_pais_cliente>55000000050</ar:Cuit_pais_cliente>
            <ar:Domicilio_cliente>Domicilio del Cliente</ar:Domicilio_cliente>
            <ar:Id_impositivo>Id9999/99</ar:Id_impositivo>
            <ar:Moneda_Id>PES</ar:Moneda_Id>
            <ar:Moneda_ctz>1</ar:Moneda_ctz>
            <ar:Obs_comerciales>Texto libre 1</ar:Obs_comerciales>
            <ar:Imp_total>1196.99</ar:Imp_total>
            <ar:Obs>Texto libre 2</ar:Obs>
            <ar:Forma_pago>Efectivo</ar:Forma_pago>
            <ar:Incoterms>FOB</ar:Incoterms>
            <ar:Incoterms_Ds>Descripción Incoter</ar:Incoterms_Ds>
            <ar:Idioma_cbte>1</ar:Idioma_cbte>
            <ar:Items>
               <ar:Item>
                    <ar:Pro_codigo>Cod0001</ar:Pro_codigo>
                    <ar:Pro_ds>Descripcion del Producto</ar:Pro_ds>
                    <ar:Pro_qty>100.555444</ar:Pro_qty>
                    <ar:Pro_umed>7</ar:Pro_umed>
                    <ar:Pro_precio_uni>12.123456</ar:Pro_precio_uni>
                    <ar:Pro_bonificacion>10</ar:Pro_bonificacion>
                    <ar:Pro_total_item>1209.08</ar:Pro_total_item>
               </ar:Item>
               <ar:Item>
                    <ar:Pro_codigo>Cod0001</ar:Pro_codigo>
                    <ar:Pro_ds>Descuento</ar:Pro_ds>
                    <ar:Pro_umed>99</ar:Pro_umed>
                    <ar:Pro_total_item>-12.09</ar:Pro_total_item>
               </ar:Item>
            </ar:Items>
         </ar:Cmp>
      </ar:FEXAuthorize>
   </soapenv:Body>
</soapenv:Envelope>




                                                                                 Página 30 de 59

---

<!-- page 31 -->

Especificaciones técnicas de Servicios Web -WSFEXV1

2.2     Recuperador de comprobante (FEXGetCMP)

2.2.1    Dirección URL
Este servicio se llama desde:
http://wswhomo.afip.gov.ar/wsfexv1/service.asmx?op=FEXGetCMP

2.2.2 Mensaje de solicitud

         <?xml version="1.0" encoding="utf-8"?>
         <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-
         instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"
         xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
           <soap:Body>
             <FEXGetCMP xmlns="http://ar.gov.afip.dif.fexv1/">
               <Auth>
                 <Token>string</Token>
                 <Sign>string</Sign>
                 <Cuit>long</Cuit>
               </Auth>
               <Cmp>
                 <Cbte_Tipo>short</Cbte_Tipo>
                 <Punto_vta>int</Punto_vta>
                 <Cbte_nro>long</Cbte_nro>
               </Cmp>
             </FEXGetCMP>
           </soap:Body>
         </soap:Envelope>


dónde:
    Campo                                 Detalle                       Obligatorio
Auth              Información de la autenticación. Contiene los datos        S
                  de Token, Sign , Cuit
Token             Token devuelto por el WSAA                                S
Sign              Sign devuelto por el WSAA                                 S
Cuit              Cuit contribuyente (representado o Emisora)               S


   Campo             Tipo                       Detalle                 Obligatorio
Cbte_Tipo       Short(N3)       Código de tipo de comprobante.               S
Punto_vta       Int(N5)         Número de punto de venta del compro-         S
                                bante
Cbte_nro        Long(N8)        Número de comprobante                       S



2.2.3    Mensaje de respuesta
Retorna los detalles de un comprobante ya enviado y autorizado.


         <?xml version="1.0" encoding="utf-8"?>
         <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-
         instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"
         xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
           <soap:Body>
             <FEXGetCMPResponse xmlns="http://ar.gov.afip.dif.fexv1/">
               <FEXGetCMPResult>
                 <FEXResultGet>
                   <Id>long</Id>
                   <Fecha_cbte>string</Fecha_cbte>
                   <Cbte_Tipo>short</Cbte_Tipo>
                   <Punto_vta>int</Punto_vta>
                   <Cbte_nro>long</Cbte_nro>


                                                                                      Página 31 de 59

---

<!-- page 32 -->

Especificaciones técnicas de Servicios Web -WSFEXV1

                  <Tipo_expo>int</Tipo_expo>
                  <Permiso_existente>string</Permiso_existente>
                  <Permisos>
                    <Permiso xsi:nil="true" />
                    <Permiso xsi:nil="true" />
                  </Permisos>
                  <Dst_cmp>double</Dst_cmp>
                  <Cliente>string</Cliente>
                  <Cuit_pais_cliente>long</Cuit_pais_cliente>
                  <Domicilio_cliente>string</Domicilio_cliente>
                  <Id_impositivo>string</Id_impositivo>
                  <Moneda_Id>string</Moneda_Id>
                  <Moneda_ctz>decimal</Moneda_ctz>
                  <CanMisMonExt>string</CanMisMonExt>
                  <Obs_comerciales>string</Obs_comerciales>
                  <Imp_total>decimal</Imp_total>
                  <Obs>string</Obs>
                  <Cmps_asoc>
                    <Cmp_asoc xsi:nil="true" />
                    <Cmp_asoc xsi:nil="true" />
                  </Cmps_asoc>
                  <Forma_pago>string</Forma_pago>
                  <Incoterms>string</Incoterms>
                  <Incoterms_Ds>string</Incoterms_Ds>
                  <Idioma_cbte>string</Idioma_cbte>
                  <Items>
                   <Item>
                      <Pro_codigo>string</Pro_codigo>
                      <Pro_ds>string</Pro_ds>
                      <Pro_qty>decimal</Pro_qty>
                      <Pro_umed>int</Pro_umed>
                      <Pro_precio_uni>decimal</Pro_precio_uni>
                      <Pro_bonificacion>decimal</Pro_bonificacion>
                       <Pro_total_item>decimal</Pro_total_item>
                    </Item>
                  </Items>
                  <Opcionales>
                    <Opcional>
                     <Id>string</Id>
                     <Valor>string</Valor>
                    </Opcional>
                  </Opcionales>
                  <Fecha_cbte_cae>string</Fecha_cbte_cae>
                  <Fch_venc_Cae>string</Fch_venc_Cae>
                  <Cae>string</Cae>
                  <Resultado>string</Resultado>
                  <Motivos_Obs>string</Motivos_Obs>
                  <Fecha_pago>string</Fecha_pago>
                  <Actividades>
                    <Actividad>
                     <Id>Long</Id>
                    </Actividad>
                  </Actividades>
                </FEXResultGet>
                <FEXErr>
                  <ErrCode>int</ErrCode>
                  <ErrMsg>string</ErrMsg>
                </FEXErr>
                <FEXEvents>
                  <EventCode>int</EventCode>
                  <EventMsg>string</EventMsg>
                </FEXEvents>
              </FEXGetCMPResult>
            </FEXGetCMPResponse>
          </soap:Body></soap:Envelope>




                                                                     Página 32 de 59

---

<!-- page 33 -->

Especificaciones técnicas de Servicios Web -WSFEXV1
Dónde:


      Campo                                      Detalle                              Obligatorio
FEXResultGet          Información completa del comprobante autorizado                      S
Ítems                 Información de los ítems que componen el documento                   S

FEXResultGet: La cabecera del comprobante está compuesta por los siguientes campos:
          Campo              Tipo                          Detalle                    Obligatorio
Id                       Long (N15)    Identificador del requerimiento                     S
Fecha_cbte               String        Fecha de comprobante (yyyymmdd)                     N
Punto_vta                Int (N5)      Punto de venta                                      S
Cbte_tipo                Short (N2)    Tipo de comprobante                                 S
Cbt_nro                  Long (N8)     Nro. de comprobante                                 S
Tipo_expo                Short(N1)     Tipo de exportación . Consultar método FEX-         S
                                       GetPARAM_Tipo_Expo
                                       Valores posibles
                                               1= Exportación definitiva de bienes
                                               2= Servicios
                                               4= Otros
Permiso_existente        String (C1)   Indica si se posee documento aduanero de            S
                                       exportación. Valores: S,N
Dst_cmp                  Double        País de destino del comprobante. Consultar          S
                                       método FEXGetPARAM_DST_pais para códi-
                                       go de países.
Cliente                  String        Apellido y nombre del comprador                     S
                         (C200)
Cuit_pais_cliente        Long (N11)    CUIT del país destino/Contribuyente. Consul-        N
                                       tar método FEXGetPARAM_DST_CUIT para
                                       valores de cuit de países.
Domicilio_cliente        String        Domicilio comercial cliente.                        S
                         (C300)
ID_impositivo            String        Clave de identificación tributaria                  N
                         (C20)
Moneda_ID                String(C4)   Código de moneda. Consultar método FEX-              S
                                      GetPARAM_MON para valores permitidos.
Moneda_Ctz               Decimal(N4, Cotización moneda. Consultar método FEX-              S
                         6)           GetPARAM_Ctz.
CanMisMonExt             String(c1)   Marca que identifica si el comprobante se            N
                                      cancela en misma moneda del comprobante
                                      (moneda extranjera). Valores posibles S o N.
Obs_comerciales          String(c4000 Observaciones comerciales                            N
                         )
Imp_total                Decimal(n13 Importe total                                         S
                         ,2)
Obs                      String(c1000 Observaciones                                        N
                         )
Forma_pago               String(C50) Forma de pago.                                        N
Incoterms                String(C3)   Incoterms                                            N
Incoterms_Ds             String(C20) Información adicional Incoterms                       N
Idioma_cbte              String(C1)   Código de idioma. Consultar método FEXGe-            S
                                      tPARAM_Idiomas para valores permitidos.
Cae                      String(C14) CAE
Fch_venc_Cae             String(C8)   Fecha de vencimiento del CAE
Resultado                String       Resultado
Motivos_Obs              String(C40) Observaciones, motivo de rechazo según ta-
                                      bla de motivos
Permisos                 Permiso      Detalle de permisos de embarque y destinos           N
Cmps_asoc                Cmp_asoc     Detalles de comprobantes asociados                   N
Ítems                    Item         Detalle de ítem                                      S
Opcionales               Opcional     Detalle de datos Opcionales                          N
Fecha_pago               String(C8)   Fecha de comprobante (yyyymmdd)                      N
Actividades              Actividad    Array para informar las actividades asociadas        N
                                      a un comprobante


                                                                                               Página 33 de 59

---

<!-- page 34 -->

Especificaciones técnicas de Servicios Web -WSFEXV1



Permisos: detalle de los permisos de embarque y destinos de las mercaderías:
          Campo               Tipo                            Detalle                 Obligatorio
Id_permisos               String (C16) Código   de despacho – Permiso de                  N
                                       Embarque
Dst_merc                  Int(N3)        País de destino de la mercadería.                N


Cmps_asoc: detalle de los comprobantes relacionados con el comprobante que se solicita
autorizar.
          Campo               Tipo                            Detalle                 Obligatorio
Cbte_tipo                 Short(N3)      Código de tipo de comprobante.                   N
Cbte_punto_vta            Int(N5)        Punto de venta                                   N
Cbte_nro                  Long(N8)       Número de comprobante                            N
Cbte_cuit                 Long(N11)      CUIT que generó el comprobante                   N


Items: el detalle de los ítems del comprobante está compuesto por los siguientes campos:
          Campo               Tipo                            Detalle                 Obligatorio
Pro_codigo                String (C50)   Código de producto                               N
Pro_ds                    String         Descripción de producto                          S
                          (C4000)
Pro_qty                   Decimal        Cantidad                                         N
                          (N12,6)
Pro_umed                  Int(N2)        Unidad de medida.                                S
Pro_precio_uni            Decimal        Precio unitario                                  N
                          (N12,6)
Pro_bonificacion          Decimal        Bonificación sobre el ítem                       N
                          (N12,6)
Pro_total_item            Decimal        Importe total ítem                               S
                          (N13,2)


Opcional: datos opcionales del comprobante. Está compuesto por los siguientes campos:
          Campo               Tipo                            Detalle                 Obligatorio
Id                        String (4)      Identificador de dato opcional                  S
Valor                     String (250)    Valor que acompaña al identificador.            S


Actividad: Detalle de la actividad relacionada con las actividades (array) que se indican en el
comprobante a autorizar.
   Campo            Tipo                         Detalle                    Obligatorio
                                     Código    actividad según               método
 Id                Long (6)                                                              S
                                     FEXGetPARAM_Actividades




2.2.4    Errores
        Código de error                                   Mensaje de error
             1020               Comprobante inexistente

2.3     Recuperador de último valor de Id de requerimiento (FEXGetLast_ID)

2.3.1    Dirección URL
Este servicio se llama desde:
http://wswhomo.afip.gov.ar/wsfexv1/service.asmx?op= FEXGetLastID



                                                                                              Página 34 de 59

---

<!-- page 35 -->

Especificaciones técnicas de Servicios Web -WSFEXV1
2.3.2    Mensaje de solicitud
Recibe las credenciales de autenticación y la cuit del usuario representado.
         <?xml version="1.0" encoding="utf-8"?>
         <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-
         instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"
         xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
           <soap:Body>
             <FEXGetLast_ID xmlns="http://ar.gov.afip.dif.fexv1/">
               <Auth>
                 <Token>string</Token>
                 <Sign>string</Sign>
                 <Cuit>long</Cuit>
               </Auth>
             </FEXGetLast_ID>
           </soap:Body>
         </soap:Envelope>




Dónde:
    Campo                                  Detalle                           Obligatorio
Auth               Información de la autenticación. Contiene los datos            S
                   de Token, Sign , Cuit
Token              Token devuelto por el WSAA                                    S
Sign               Sign devuelto por el WSAA                                     S
Cuit               Cuit contribuyente (representado o Emisora)                   S


2.3.3    Mensaje de respuesta
Retorna el último id de requerimiento para la cuit enviada.
         <?xml version="1.0" encoding="utf-8"?>
         <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-
         instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"
         xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
         <soap:Body>
             <FEXGetLast_IDResponse xmlns="http://ar.gov.afip.dif.fexv1/">
               <FEXGetLast_IDResult>
                 <FEXResultGet>
                   <Id>long</Id>
                 </FEXResultGet>
                 <FEXErr>
                   <ErrCode>int</ErrCode>
                   <ErrMsg>string</ErrMsg>
                 </FEXErr>
                 <FEXEvents>
                   <EventCode>int</EventCode>
                   <EventMsg>string</EventMsg>
                 </FEXEvents>
               </FEXGetLast_IDResult>
             </FEXGetLast_IDResponse>
           </soap:Body>
         </soap:Envelope>


Dónde:
                Campo                       Tipo                   Detalle                 Obligatorio
Id                                          Long       Id de requerimiento                     S


2.3.4    Validaciones, acciones y errores
Este servicio devuelve el siguiente código de error:

                                                                                                 Página 35 de 59

---

<!-- page 36 -->

Especificaciones técnicas de Servicios Web -WSFEXV1
                                          Código de
      Descripción de la validación                                   Mensaje de error
                                            error
Verificación de Token y Firma               1000        Usuario no autorizado        a realizar esta
                                                        operación
Cuit solicitante se encuentra entre sus      1001       Cuit solicitante no se encuentra entre sus
representados                                           representados



2.4     Recuperador del último Cbte_nro autorizado (FEXGetLast_CMP)

2.4.1    Dirección URL
Este servicio se llama desde:
http://wswhomo.afip.gov.ar/wsfexv1/service.asmx?op= FEXGetLast_CMP

2.4.2    Mensaje de solicitud
Recibe las credenciales de autenticación y la cuit del usuario representado.
          <?xml version="1.0" encoding="utf-8"?>
          <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-
          instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"
          xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
          <soap:Body>
              <FEXGetLast_CMP xmlns="http://ar.gov.afip.dif.fexv1/">
                <Auth>
                  <Token>string</Token>
                  <Sign>string</Sign>
                  <Cuit>long</Cuit>
                  <Pto_venta>short</Pto_venta>
                  <Cbte_Tipo>short</Cbte_Tipo>
                </Auth>
              </FEXGetLast_CMP>
            </soap:Body>
          </soap:Envelope>

dónde:
    Campo                                  Detalle                          Obligatorio
Auth               Información de la autenticación. Contiene los datos           S
                   de Token, Sign , Cuit
Token              Token devuelto por el WSAA                                    S
Sign               Sign devuelto por el WSAA                                     S
Cuit               Cuit contribuyente (representado o Emisora)                   S
Pto_venta          Punto de venta                                                S
Cbte_Tipo          Tipo de comprobante                                           S


2.4.3    Mensaje de respuesta
Retorna el último número de comprobante autorizado para el punto de venta y tipo de
comprobante enviado.
          <?xml version="1.0" encoding="utf-8"?>
          <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-
          instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"
          xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
          <soap:Body>
              <FEXGetLast_CMPResponse xmlns="http://ar.gov.afip.dif.fexv1/">
                <FEXGetLast_CMPResult>
                  <FEXResult_LastCMP>
                    <Cbte_nro>long</Cbte_nro>
                    <Cbte_fecha>string</Cbte_fecha>
                  </FEXResult_LastCMP>
                  <FEXErr>
                    <ErrCode>int</ErrCode>


                                                                                                Página 36 de 59

---

<!-- page 37 -->

Especificaciones técnicas de Servicios Web -WSFEXV1

                    <ErrMsg>string</ErrMsg>
                  </FEXErr>
                  <FEXEvents>
                    <EventCode>int</EventCode>
                    <EventMsg>string</EventMsg>
                  </FEXEvents>
                </FEXGetLast_CMPResult>
              </FEXGetLast_CMPResponse>
            </soap:Body>
          </soap:Envelope>



Dónde:
                Campo                        Tipo               Detalle               Obligatorio
Cbte_nro                                    Long(N8)   Número de comprobante              S
Cbte_fecha                                String(C8)   Fecha (yyyymmdd)                   S


2.4.4    Validaciones, acciones y errores
Este servicio devuelve el siguiente código de error:
                                          Código de
      Descripción de la validación                                 Mensaje de error
                                            error
Verificación de Token y Firma               1000       Usuario no autorizado     a realizar esta
                                                       operación
Cuit solicitante se encuentra entre sus      1001      Cuit solicitante no se encuentra entre sus
representados                                          representados
Verificación del campo Cbte_Tipo             1606      Campo Cbte_Tipo no se corresponde con
                                                       alguno de los comprobantes habilitados.
                                                       Recuerde que los valores son 19, 20 o 21
Verificación del campo Pto_venta             1607      Campo Pto_venta no es valido o no esta
                                                       dado de alta como punto de venta de
                                                       'Comprobantes de Exportación - Web
                                                       Services'




2.5     Recuperador de valores referenciales de códigos de Moneda
        (FEXGetPARAM_MON)

2.5.1    Dirección URL
Este servicio se llama desde:
http://wswhomo.afip.gov.ar/wsfexv1/service.asmx?op= FEXGetPARAM_MON

2.5.2    Mensaje de solicitud
Recibe las credenciales de autenticación y la cuit del usuario representado.
          <?xml version="1.0" encoding="utf-8"?><soap:Envelope
          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
          xmlns:xsd="http://www.w3.org/2001/XMLSchema"
          xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
            <soap:Body>
              <FEXGetPARAM_MON xmlns="http://ar.gov.afip.dif.fexv1/">
                <Auth>
                  <Token>string</Token>
                  <Sign>string</Sign>
                  <Cuit>long</Cuit>
                </Auth>
              </FEXGetPARAM_MON>


                                                                                            Página 37 de 59

---

<!-- page 38 -->

Especificaciones técnicas de Servicios Web -WSFEXV1

            </soap:Body></soap:Envelope>

Dónde:


    Campo                                  Detalle                        Obligatorio
Auth               Información de la autenticación. Contiene los datos         S
                   de Token, Sign , Cuit
Token              Token devuelto por el WSAA                                    S
Sign               Sign devuelto por el WSAA                                     S
Cuit               Cuit contribuyente (representado o Emisora)                   S


2.5.3    Mensaje de respuesta
Retorna el total de monedas válidas.
         <?xml version="1.0" encoding="utf-8"?>
         <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-
         instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"
         xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
           <soap:Body>
             <FEXGetPARAM_MONResponse xmlns="http://ar.gov.afip.dif.fexv1/">
               <FEXGetPARAM_MONResult>
                 <FEXResultGet>
                   <ClsFEXResponse_Mon>
                     <Mon_Id>string</Mon_Id>
                     <Mon_Ds>string</Mon_Ds>
                     <Mon_vig_desde>string</Mon_vig_desde>
                     <Mon_vig_hasta>string</Mon_vig_hasta>
                   </ClsFEXResponse_Mon>
                   <ClsFEXResponse_Mon>
                     <Mon_Id>string</Mon_Id>
                     <Mon_Ds>string</Mon_Ds>
                     <Mon_vig_desde>string</Mon_vig_desde>
                     <Mon_vig_hasta>string</Mon_vig_hasta>
                   </ClsFEXResponse_Mon>
                 </FEXResultGet>
                 <FEXErr>
                   <ErrCode>int</ErrCode>
                   <Errmsg>string</Errmsg>
                 </FEXErr>
                 <FEXEvents>
                   <EventCode>int</EventCode>
                   <EventMsg>string</EventMsg>
                 </FEXEvents>
               </FEXGetPARAM_MONResult>
             </FEXGetPARAM_MONResponse>
           </soap:Body></soap:Envelope>


Dónde:
                 Campo                         Tipo                  Detalle            Obligatorio
Mon_id                                      String(C3)   Código de moneda                   S
Mon_ds                                      String(C250) Descripción de moneda              S
Mon_vig_desde                               String(C8)   Fecha de vigencia desde            S
Mon_vig_hasta                               String(C8)   Fecha de vigencia hasta            N


2.5.4    Validaciones, acciones y errores
Este servicio devuelve el siguiente código de error:




                                                                                          Página 38 de 59

---

<!-- page 39 -->

Especificaciones técnicas de Servicios Web -WSFEXV1
                                          Código de
      Descripción de la validación                                   Mensaje de error
                                            error
Verificación de Token y Firma               1000        Usuario no autorizado        a realizar esta
                                                        operación
Cuit solicitante se encuentra entre sus      1001       Cuit solicitante no se encuentra entre sus
representados                                           representados



2.6     Recuperador de valores referenciales de códigos de Tipos de comprobante
        (FEXGetPARAM_Cbte_Tipo)

2.6.1    Dirección URL
Este servicio se llama desde:
http://wswhomo.afip.gov.ar/wsfexv1/service.asmx?op= FEXGetPARAM_Cbte_Tipo

2.6.2    Mensaje de solicitud
Recibe las credenciales de autenticación y la cuit del usuario representado.
          <?xml version="1.0" encoding="utf-8"?>
          <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-
          instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"
          xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
            <soap:Body>
              <FEXGetPARAM_Cbte_Tipo xmlns="http://ar.gov.afip.dif.fexv1/">
                <Auth>
                  <Token>string</Token>
                  <Sign>string</Sign>
                  <Cuit>string</Cuit>
                </Auth>
              </FEXGetPARAM_Cbte_Tipo>
          </soap:Body>
          </soap:Envelope>

Dónde:
    Campo                                  Detalle                          Obligatorio
Auth               Información de la autenticación. Contiene los datos           S
                   de Token, Sign , Cuit
Token              Token devuelto por el WSAA                                    S
Sign               Sign devuelto por el WSAA                                     S
Cuit               Cuit contribuyente (representado o Emisora)                   S


2.6.3    Mensaje de respuesta
Retorna el universo de tipos de comprobante válidos.
          <?xml version="1.0" encoding="utf-8"?>
          <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-
          instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"
          xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
            <soap:Body>
              <FEXGetPARAM_Cbte_TipoResponse
          xmlns="http://ar.gov.afip.dif.fexv1/">
                <FEXGetPARAM_Cbte_TipoResult>
                  <FEXResultGet>
                    <ClsFEXResponse_Cbte_Tipo>
                      <Cbte_Id>short</Cbte_Id>
                      <Cbte_Ds>string</Cbte_Ds>
                      <Cbte_vig_desde>string</Cbte_vig_desde>
                      <Cbte_vig_hasta>string</Cbte_vig_hasta>
                    </ClsFEXResponse_Cbte_Tipo>
                    <ClsFEXResponse_Cbte_Tipo>
                      <Cbte_Id>short</Cbte_Id>


                                                                                                Página 39 de 59

---

<!-- page 40 -->

Especificaciones técnicas de Servicios Web -WSFEXV1

                      <Cbte_Ds>string</Cbte_Ds>
                      <Cbte_vig_desde>string</Cbte_vig_desde>
                      <Cbte_vig_hasta>string</Cbte_vig_hasta>
                    </ClsFEXResponse_Cbte_Tipo>
                  </FEXResultGet>
                  <FEXErr>
                    <ErrCode>int</ErrCode>
                    <Errmsg>string</Errmsg>
                  </FEXErr>
                  <FEXEvents>
                    <EventCode>int</EventCode>
                    <EventMsg>string</EventMsg>
                  </FEXEvents>
                </FEXGetPARAM_Cbte_TipoResult>
              </FEXGetPARAM_Cbte_TipoResponse>
            </soap:Body></soap:Envelope>




Dónde:
                  Campo                          Tipo                Detalle                  Obligatorio
Cbte_id                                     Short(N2)    Código de comprobante                     S
Cbte_ds                                     String(C250) Descripción                               S
Cbte_vig_desde                              String(C8)   Fecha de vigencia desde                      S
Cbte_vig_hasta                              String(C8)   Fecha de vigencia hasta                      N


2.6.4    Validaciones, acciones y errores
Este servicio devuelve el siguiente código de error:
                                          Código de
      Descripción de la validación                                    Mensaje de error
                                            error
Verificación de Token y Firma               1000         Usuario no autorizado       a realizar esta
                                                         operación
Cuit solicitante se encuentra entre sus      1001        Cuit solicitante no se encuentra entre sus
representados                                            representados




2.7     Recuperador de valores referenciales de códigos de Tipo de exportación
        (FEXGetPARAM_Tipo_Expo)

2.7.1    Dirección URL
Este servicio se llama desde:
http://wswhomo.afip.gov.ar/wsfexv1/service.asmx?op= FEXGetPARAM_Tipo_Expo



2.7.2    Mensaje de solicitud
Recibe las credenciales de autenticación y la cuit del usuario representado.
          <?xml version="1.0" encoding="utf-8"?>
          <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-
          instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"
          xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
            <soap:Body>
              <FEXGetPARAM_Tipo_Expo xmlns="http://ar.gov.afip.dif.fexv1/">
                <Auth>


                                                                                                 Página 40 de 59

---

<!-- page 41 -->

Especificaciones técnicas de Servicios Web -WSFEXV1

                 <Token>string</Token>
                 <Sign>string</Sign>
                 <Cuit>string</Cuit>
               </Auth>
             </FEXGetPARAM_Tipo_Expo>
          </soap:Body> </soap:Envelope>

Dónde:
    Campo                                 Detalle                        Obligatorio
Auth              Información de la autenticación. Contiene los datos         S
                  de Token, Sign , Cuit
Token             Token devuelto por el WSAA                                  S
Sign              Sign devuelto por el WSAA                                   S
Cuit              Cuit contribuyente (representado o Emisora)                 S




2.7.3    Mensaje de respuesta
Retorna el universo de tipos de exportación válidos.
         <?xml version="1.0" encoding="utf-8"?>
         <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-
         instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"
         xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
           <soap:Body>
             <FEXGetPARAM_Tipo_ExpoResponse
         xmlns="http://ar.gov.afip.dif.fexv1/">
               <FEXGetPARAM_Tipo_ExpoResult>
                 <FEXResultGet>
                   <ClsFEXResponse_Tex>
                     <Tex_Id>short</Tex_Id>
                     <Tex_Ds>string</Tex_Ds>
                     <Tex_vig_desde>string</Tex_vig_desde>
                     <Tex_vig_hasta>string</Tex_vig_hasta>
                   </ClsFEXResponse_Tex>
                   <ClsFEXResponse_Tex>
                     <Tex_Id>short</Tex_Id>
                     <Tex_Ds>string</Tex_Ds>
                     <Tex_vig_desde>string</Tex_vig_desde>
                     <Tex_vig_hasta>string</Tex_vig_hasta>
                   </ClsFEXResponse_Tex>
                 </FEXResultGet>
                 <FEXErr>
                   <ErrCode>int</ErrCode>
                   <ErrMsg>string</ErrMsg>
                 </FEXErr>
                 <FEXEvents>
                   <EventCode>int</EventCode>
                   <EventMsg>string</EventMsg>
                 </FEXEvents>
               </FEXGetPARAM_Tipo_ExpoResult>
             </FEXGetPARAM_Tipo_ExpoResponse>
           </soap:Body>
          </soap:Envelope>


Dónde:
                Campo                          Tipo                Detalle              Obligatorio
Tex_id                                    Short(N2)    Código de Tipo de exportación.        S
Tex_ds                                    String(C250) Descripción                           S
Tex_vig_desde                             String(C8)    Fecha de vigencia desde             S


                                                                                          Página 41 de 59

---

<!-- page 42 -->

Especificaciones técnicas de Servicios Web -WSFEXV1
Tex_vig_hasta                               String(C8)   Fecha de vigencia hasta                      N




2.7.4    Validaciones, acciones y errores
Este servicio devuelve el siguiente código de error:
                                          Código de
      Descripción de la validación                                    Mensaje de error
                                            error
Verificación de Token y Firma               1000         Usuario no autorizado        a realizar esta
                                                         operación
Cuit solicitante se encuentra entre sus      1001        Cuit solicitante no se encuentra entre sus
representados                                            representados




2.8     Recuperador de valores referenciales de códigos de Unidades de Medida
        (FEXGetPARAM_Umed)

2.8.1    Dirección URL
Este servicio se llama desde:
http://wswhomo.afip.gov.ar/wsfexv1/service.asmx?op= FEXGetPARAM_Umed

2.8.2    Mensaje de solicitud
Recibe las credenciales de autenticación y la cuit del usuario representado.
          <?xml version="1.0" encoding="utf-8"?>
          <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-
          instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"
          xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
            <soap:Body>
              <FEXGetPARAM_Umed xmlns="http://ar.gov.afip.dif.fexv1/">
                <Auth>
                  <Token>string</Token>
                  <Sign>string</Sign>
                  <Cuit>string</Cuit>
                </Auth>
              </FEXGetPARAM_Umed>
            </soap:Body>
          </soap:Envelope>

Dónde:
   Campo                                   Detalle                           Obligatorio
Auth               Información de la autenticación. Contiene los datos            S
                   de Token, Sign , Cuit
Token              Token devuelto por el WSAA                                     S
Sign               Sign devuelto por el WSAA                                      S
Cuit               Cuit contribuyente (representado o Emisora)                    S




2.8.3    Mensaje de respuesta
Retorna el universo de unidades de medida válidos.
          <?xml version="1.0" encoding="utf-8"?>
          <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-
          instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"
          xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">



                                                                                                 Página 42 de 59

---

<!-- page 43 -->

Especificaciones técnicas de Servicios Web -WSFEXV1

          <soap:Body>
              <FEXGetPARAM_UMedResponse
          xmlns="http://ar.gov.afip.dif.fexv1/">
                <FEXGetPARAM_UMedResult>
                  <FEXResultGet>
                    <ClsFEXResponse_UMed>
                      <Umed_Id>short</Umed_Id>
                      <Umed_Ds>string</Umed_Ds>
                      <Umed_vig_desde>string</Umed_vig_desde>
                      <Umed_vig_hasta>string</Umed_vig_hasta>
                    </ClsFEXResponse_UMed>
                    <ClsFEXResponse_UMed>
                      <Umed_Id>short</Umed_Id>
                      <Umed_Ds>string</Umed_Ds>
                      <Umed_vig_desde>string</Umed_vig_desde>
                      <Umed_vig_hasta>string</Umed_vig_hasta>
                    </ClsFEXResponse_UMed>
                  </FEXResultGet>
                  <FEXErr>
                    <ErrCode>int</ErrCode>
                    <ErrMsg>string</ErrMsg>
                  </FEXErr>
                  <FEXEvents>
                    <EventCode>int</EventCode>
                    <EventMsg>string</EventMsg>
                  </FEXEvents>
                </FEXGetPARAM_UMedResult>
              </FEXGetPARAM_UMedResponse>
            </soap:Body>
          </soap:Envelope>


Dónde:
                 Campo                         Tipo                   Detalle                Obligatorio
Umed_id                                     Short(N2)    Código de unidad de medida                   S
Umed_ds                                     String(C250) Descripción                                  S
Umed_vig_desde                              String(C8)   Fecha de vigencia desde                      S
Umed_vig_hasta                              String(C8)   Fecha de vigencia hasta                      N


2.8.4    Validaciones, acciones y errores
Este servicio devuelve el siguiente código de error:
                                          Código de
      Descripción de la validación                                    Mensaje de error
                                            error
Verificación de Token y Firma               1000         Usuario no autorizado       a realizar esta
                                                         operación
Cuit solicitante se encuentra entre sus      1001        Cuit solicitante no se encuentra entre sus
representados                                            representados




2.9     Recuperador de valores referenciales de códigos de Idiomas
        (FEXGetPARAM_Idiomas)

2.9.1    Dirección URL
Este servicio se llama desde:
http://wswhomo.afip.gov.ar/wsfexv1/service.asmx?op= FEXGetPARAM_Idiomas



                                                                                                 Página 43 de 59

---

<!-- page 44 -->

Especificaciones técnicas de Servicios Web -WSFEXV1
2.9.2    Mensaje de solicitud
Recibe las credenciales de autenticación y la CUIT del usuario representado.


         <?xml version="1.0" encoding="utf-8"?>
         <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-
         instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"
         xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
           <soap:Body>
             <FEXGetPARAM_Idiomas xmlns="http://ar.gov.afip.dif.fexv1/">
               <Auth>
                 <Token>string</Token>
                 <Sign>string</Sign>
                 <Cuit>string</Cuit>
               </Auth>
             </FEXGetPARAM_Idiomas >
           </soap:Body>
         </soap:Envelope>

Dónde:
    Campo                                 Detalle                       Obligatorio
Auth              Información de la autenticación. Contiene los datos        S
                  de Token, Sign , Cuit
Token             Token devuelto por el WSAA                                S
Sign              Sign devuelto por el WSAA                                 S
Cuit              Cuit contribuyente (representado o Emisora)               S


2.9.3    Mensaje de respuesta
Retorna el universo de Idiomas válidos.
         <?xml version="1.0" encoding="utf-8"?>
         <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-
         instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"
         xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
         <soap:Body>
             <FEXGetPARAM_IdiomasResponse
         xmlns="http://ar.gov.afip.dif.fexv1/">
               <FEXGetPARAM_IdiomasResult>
                 <FEXResultGet>
                   <ClsFEXResponse_Idi>
                     <Idi_Id>short</Idi_Id>
                     <idi_Ds>string</idi_Ds>
                     <idi_vig_desde>string</idi_vig_desde>
                     <idi_vig_hasta>string</idi_vig_hasta>
                   </ClsFEXResponse_Idi>
                   <ClsFEXResponse_Idi>
                     <Idi_Id>short</Idi_Id>
                     <idi_Ds>string</idi_Ds>
                     <idi_vig_desde>string</idi_vig_desde>
                     <idi_vig_hasta>string</idi_vig_hasta>
                   </ClsFEXResponse_Idi>
                 </FEXResultGet>
                 <FEXErr>
                   <ErrCode>int</ErrCode>
                   <ErrMsg>string</ErrMsg>
                 </FEXErr>
                 <FEXEvents>
                   <EventCode>int</EventCode>
                   <EventMsg>string</EventMsg>
                 </FEXEvents>
               </FEXGetPARAM_IdiomasResult>
             </FEXGetPARAM_IdiomasResponse>
           </soap:Body>



                                                                                      Página 44 de 59

---

<!-- page 45 -->

Especificaciones técnicas de Servicios Web -WSFEXV1

           </soap:Envelope>




Dónde:
                  Campo                         Tipo                   Detalle                Obligatorio
Idi_id                                       Short(N2)    Código de idioma                             S
Idi_ds                                       String(C250) Descripción                                  S
Idi_vig_desde                                String(C8)   Fecha de vigencia desde                      S
Idi_vig_hasta                                String(C8)   Fecha de vigencia hasta                      N


2.9.4     Validaciones, acciones y errores
Este servicio devuelve el siguiente código de error:
                                           Código de
    Descripción de la validación                                       Mensaje de error
                                             error
Verificación de Token y Firma                1000         Usuario no autorizado       a realizar esta
                                                          operación
Cuit solicitante se encuentra entre sus       1001        Cuit solicitante no se encuentra entre sus
representados                                             representados




2.10 Recuperador de valores referenciales de códigos de Países
         (FEXGetPARAM_DST_pais)

2.10.1 Dirección URL
Este servicio se llama desde:
http://wswhomo.afip.gov.ar/wsfexv1/service.asmx?op= FEXGetPARAM_DST_Pais

2.10.2 Mensaje de solicitud
Recibe las credenciales de autenticación y la cuit del usuario representado.
          <?xml version="1.0" encoding="utf-8"?>
          <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-
          instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"
          xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
            <soap:Body>
              <FEXGetPARAM_DST_Pais xmlns="http://ar.gov.afip.dif.fexv1/">
                <Auth>
                  <Token>string</Token>
                  <Sign>string</Sign>
                  <Cuit>string</Cuit>
                </Auth>
              </FEXGetPARAM_DST_Pais>
            </soap:Body>
           </soap:Envelope>




Dónde:
    Campo                                  Detalle                            Obligatorio
Auth                Información de la autenticación. Contiene los datos            S
                    de Token, Sign , Cuit


                                                                                                  Página 45 de 59

---

<!-- page 46 -->

Especificaciones técnicas de Servicios Web -WSFEXV1
Token              Token devuelto por el WSAA                                   S
Sign               Sign devuelto por el WSAA                                    S
Cuit               Cuit contribuyente (representado o Emisora)                  S


2.10.3 Mensaje de respuesta
Retorna el universo de países válidos.
         <?xml versión=”1.0” encoding="utf-8"?>
         <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-
         instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"
         xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
         <soap:Body>
             <FEXGetPARAM_DST_paisResponse
         xmlns="http://ar.gov.afip.dif.fexv1/">
               <FEXGetPARAM_DST_paisResult>
                 <FEXResultGet>
                   <ClsFEXResponse_DST_pais>
                     <DST_Codigo>string</DST_Codigo>
                     <DST_Ds>string</DST_Ds>
                   </ClsFEXResponse_DST_pais>
                   <ClsFEXResponse_DST_pais>
                     <DST_Codigo>string</DST_Codigo>
                     <DST_Ds>string</DST_Ds>
                   </ClsFEXResponse_DST_pais>
                 </FEXResultGet>
                 <FEXErr>
                   <ErrCode>int</ErrCode>
                   <ErrMsg>string</ErrMsg>
                 </FEXErr>
                 <FEXEvents>
                   <EventCode>int</EventCode>
                   <EventMsg>string</EventMsg>
                 </FEXEvents>
               </FEXGetPARAM_DST_paisResult>
             </FEXGetPARAM_DST_paisResponse>
           </soap:Body>
         </soap:Envelope>


Dónde:
                Campo                        Tipo                Detalle               Obligatorio
DST_Codigo                                String(C3)   Código de País                        S
DST_Ds                                    String(C250) Descripción                           S


2.10.4 Validaciones, acciones y errores
Este servicio devuelve el siguiente código de error:
                                          Código de
    Descripción de la validación                                    Mensaje de error
                                            error
Verificación de Token y Firma               1000       Usuario no autorizado        a realizar esta
                                                       operación
Cuit solicitante se encuentra entre sus      1001      Cuit solicitante no se encuentra entre sus
representados                                          representados



2.11 Recuperador de valores referenciales de Incoterms (FEXGetPARAM_Incoterms)

2.11.1 Dirección URL
Este servicio se llama desde:
http://wswhomo.afip.gov.ar/wsfexv1/service.asmx?op= FEXGetPARAM_Incoterms


                                                                                               Página 46 de 59

---

<!-- page 47 -->

Especificaciones técnicas de Servicios Web -WSFEXV1
2.11.2 Mensaje de solicitud
Recibe las credenciales de autenticación y la cuit del usuario representado.
         <?xml version="1.0" encoding="utf-8"?>
         <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-
         instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"
         xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
           <soap:Body>
             <FEXGetPARAM_Incoterms xmlns="http://ar.gov.afip.dif.fexv1/">
               <Auth>
                 <Token>string</Token>
                 <Sign>string</Sign>
                 <Cuit>long</Cuit>
               </Auth>
             </FEXGetPARAM_Incoterms>
         </soap:Body>
         </soap:Envelope>


Dónde:


    Campo                                 Detalle                       Obligatorio
Auth              Información de la autenticación. Contiene los datos        S
                  de Token, Sign , Cuit
Token             Token devuelto por el WSAA                                S
Sign              Sign devuelto por el WSAA                                 S
Cuit              Cuit contribuyente (representado o Emisora)               S


2.11.3 Mensaje de respuesta
Retorna el universo códigos válidos.
         <?xml version="1.0" encoding="utf-8"?>
         <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-
         instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"
         xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
         <soap:Body>
           <FEXGetPARAM_IncotermsResponse
         xmlns="http://ar.gov.afip.dif.fexv1/">
               <FEXGetPARAM_IncotermsResult>
                 <FEXResultGet>
                   <ClsFEXResponse_Inc>
                     <Inc_Id>short</Inc_Id>
                     <Inc_Ds>string</Inc_Ds>
                     <Inc_vig_desde>string</Inc_vig_desde>
                     <Inc_vig_hasta>string</Inc_vig_hasta>
                   </ClsFEXResponse_Inc>
                   <ClsFEXResponse_Inc>
                     <Inc_Id>short</Inc_Id>
                     <Inc_Ds>string</Inc_Ds>
                     <Inc_vig_desde>string</Inc_vig_desde>
                     <Inc_vig_hasta>string</Inc_vig_hasta>
                   </ClsFEXResponse_Inc>
                 </FEXResultGet>
                 <FEXErr>
                   <ErrCode>int</ErrCode>
                   <ErrMsg>string</ErrMsg>
                 </FEXErr>
                 <FEXEvents>
                   <EventCode>int</EventCode>
                   <EventMsg>string</EventMsg>
                 </FEXEvents>
               </FEXGetPARAM_IncotermsResult>
             </FEXGetPARAM_IncotermsResponse>
           </soap:Body>


                                                                                      Página 47 de 59

---

<!-- page 48 -->

Especificaciones técnicas de Servicios Web -WSFEXV1

         </soap:Envelope>


Dónde:
                Campo                        Tipo                  Detalle                 Obligatorio
Inc_Id                                    String(C3)   Código de incoterm                      S
Inc_Ds                                    String(C250) Descripción                             S
Inc_vig_desde                             String(C8)   Fecha de vigencia desde                 S
Inc_vig_hasta                             String(C8)   Fecha de vigencia hasta                 N




2.11.4 Validaciones, acciones y errores
Este servicio devuelve el siguiente código de error:
                                           Código de
    Descripción de la validación                                     Mensaje de error
                                             error
Verificación de Token y Firma                1000       Usuario no autorizado        a realizar esta
                                                        operación
Cuit solicitante se encuentra entre sus      1001       Cuit solicitante no se encuentra entre sus
representados                                           representados




2.12 Recuperador de valores referenciales de CUITs de Países
      (FEXGetPARAM_DST_CUIT)

2.12.1 Dirección URL
Este servicio se llama desde:
http://wswhomo.afip.gov.ar/wsfexv1/service.asmx?op= FEXGetPARAM_DST_CUIT

2.12.2 Mensaje de solicitud
Recibe las credenciales de autenticación y la cuit del usuario representado.
         <?xml version="1.0" encoding="utf-8"?>
         <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-
         instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"
         xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
           <soap:Body>
             <FEXGetPARAM_DST_CUIT xmlns="http://ar.gov.afip.dif.fexv1/">
               <Auth>
                 <Token>string</Token>
                 <Sign>string</Sign>
                 <Cuit>string</Cuit>
               </Auth>
             </FEXGetPARAM_DST_CUIT>
           </soap:Body>
          </soap:Envelope>




Dónde:
    Campo                                 Detalle                            Obligatorio
Auth               Información de la autenticación. Contiene los datos            S
                   de Token, Sign , Cuit
Token              Token devuelto por el WSAA                                    S
Sign               Sign devuelto por el WSAA                                     S

                                                                                                   Página 48 de 59

---

<!-- page 49 -->

Especificaciones técnicas de Servicios Web -WSFEXV1
Cuit               Cuit contribuyente (representado o Emisora)                   S


2.12.3 Mensaje de respuesta
Retorna el universo CUITs de países válidos.
         <?xml version="1.0" encoding="utf-8"?>
         <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-
         instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"
         xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
         <soap:Body>
             <FEXGetPARAM_DST_CUITResponse
         xmlns="http://ar.gov.afip.dif.fexv1/">
               <FEXGetPARAM_DST_CUITResult>
                 <FEXResultGet>
                   <ClsFEXResponse_DST_cuit>
                     <DST_CUIT>string</DST_CUIT>
                     <DST_Ds>string</DST_Ds>
                   </ClsFEXResponse_DST_cuit>
                   <ClsFEXResponse_DST_cuit>
                     <DST_CUIT>string</DST_CUIT>
                     <DST_Ds>string</DST_Ds>
                   </ClsFEXResponse_DST_cuit>
                 </FEXResultGet>
                 <FEXErr>
                   <ErrCode>int</ErrCode>
                   <ErrMsg>string</ErrMsg>
                 </FEXErr>
                 <FEXEvents>
                   <EventCode>int</EventCode>
                   <EventMsg>string</EventMsg>
                 </FEXEvents>
               </FEXGetPARAM_DST_CUITResult>
             </FEXGetPARAM_DST_CUITResponse>
           </soap:Body>
         </soap:Envelope>


Dónde:
                Campo                          Tipo                Detalle               Obligatorio
DST_CUIT                                  String(C11) CUIT de País                            S
DST_Ds                                    String(C250) Descripción                            S


2.12.4 Validaciones, acciones y errores
Este servicio devuelve el siguiente código de error:
                                          Código de
    Descripción de la validación                                     Mensaje de error
                                            error
Verificación de Token y Firma               1000        Usuario no autorizado        a realizar esta
                                                        operación
Cuit solicitante se encuentra entre sus      1001       Cuit solicitante no se encuentra entre sus
representados                                           representados



2.13 Recuperador de cotización de moneda (FEXGetPARAM_Ctz)

2.13.1 Dirección URL
Este servicio se llama desde:
http://wswhomo.afip.gov.ar/wsfexv1/service.asmx?op= FEXGetPARAM_Ctz




                                                                                                Página 49 de 59

---

<!-- page 50 -->

Especificaciones técnicas de Servicios Web -WSFEXV1
2.13.2 Mensaje de solicitud
Recibe las credenciales de autenticación, cuit del usuario representado y el código de moneda.
         <?xml version="1.0" encoding="utf-8"?>
         <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-
         instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"
         xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
           <soap:Body>
             <FEXGetPARAM_Ctz xmlns="http://ar.gov.afip.dif.fexv1/">
               <Auth>
                 <Token>string</Token>
                 <Sign>string</Sign>
                 <Cuit>long</Cuit>
               </Auth>
               <Mon_id>string</Mon_id>
               <FchCotiz>string</FchCotiz>
             </FEXGetPARAM_Ctz>
           </soap:Body>
         </soap:Envelope>

Dónde:
    Campo                                 Detalle                         Obligatorio
Auth              Información de la autenticación. Contiene los datos          S
                  de Token, Sign , Cuit
Token             Token devuelto por el WSAA                                  S
Sign              Sign devuelto por el WSAA                                   S
Cuit              Cuit contribuyente (representado o Emisora)                 S


   Campo                                 Detalle                          Obligatorio
Mon_id            Código de moneda de la que se solicita cotización.           S
FchCotiz          Fecha a la cual se consulta la cotización de la mone-        N
                  da ingresada


2.13.3 Mensaje de respuesta
Retorna la última cotización de la base de datos aduanera de la moneda ingresada. Este valor es
orientativo.
         <?xml version="1.0" encoding="utf-8"?>
         <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-
         instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"
         xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
         <soap:Body>
         <FEXGetPARAM_CtzResponse xmlns="http://ar.gov.afip.dif.fexv1/">
               <FEXGetPARAM_CtzResult>
                 <FEXResultGet>
                   <Mon_ctz>decimal</Mon_ctz>
                   <Mon_fecha>string</Mon_fecha>
                 </FEXResultGet>
                 <FEXErr>
                   <ErrCode>int</ErrCode>
                   <ErrMsg>string</ErrMsg>
                 </FEXErr>
                 <FEXEvents>
                   <EventCode>int</EventCode>
                   <EventMsg>string</EventMsg>
                 </FEXEvents>
               </FEXGetPARAM_CtzResult>
             </FEXGetPARAM_CtzResponse>
           </soap:Body>
         </soap:Envelope>


Dónde:


                                                                                        Página 50 de 59

---

<!-- page 51 -->

Especificaciones técnicas de Servicios Web -WSFEXV1

                Campo                        Tipo                  Detalle                 Obligatorio
Mon_ctz                                   Decimal
                                                       Cotización de la moneda                 S
                                          (N12,6)
Mon_fecha                                 String(C8)   Fecha de la cotización                  S


2.13.4 Validaciones, acciones y errores
Este servicio devuelve el siguiente código de error:
                                           Código de
    Descripción de la validación                                     Mensaje de error
                                             error
Verificación de Token y Firma                1000       Usuario no autorizado        a realizar esta
                                                        operación
Cuit solicitante se encuentra entre sus      1001       Cuit solicitante no se encuentra entre sus
representados                                           representados
FchCotiz                                     1003       De informar el campo, el mismo debe tener
                                                        el sig. formato YYYY-MM-DD



2.14 Recuperador de los puntos de venta asignados a Facturación electrónica de
      comprobantes de Exportación vía Web Services (FEXGetPARAM_PtoVenta)

2.14.1 Dirección URL
Este servicio se llama desde:
http://wswhomo.afip.gov.ar/wsfexv1/service.asmx?op= FEXGetPARAM_PtoVenta

2.14.2 Mensaje de solicitud
Recibe las credenciales de autenticación, cuit del usuario representado.
         <?xml version="1.0" encoding="utf-8"?>
         <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-
         instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"
         xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
           <soap:Body>
             <FEXGetPARAM_PtoVenta xmlns="http://ar.gov.afip.dif.fexv1/">
               <Auth>
                 <Token>string</Token>
                 <Sign>string</Sign>
                 <Cuit>long</Cuit>
               </Auth>
             </FEXGetPARAM_PtoVenta>
           </soap:Body>
         </soap:Envelope>

Dónde:
    Campo                                  Detalle                           Obligatorio
Auth               Información de la autenticación. Contiene los datos            S
                   de Token, Sign , Cuit
Token              Token devuelto por el WSAA                                    S
Sign               Sign devuelto por el WSAA                                     S
Cuit               Cuit contribuyente (representado o Emisora)                   S
2.14.3 Mensaje de respuesta
Retorna el listado de los puntos de venta registrados para la operación de comprobantes
electrónicos para exportación vía web services.
         <?xml version="1.0" encoding="utf-8"?>
         <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-
         instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"
         xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
         <soap:Body>


                                                                                                 Página 51 de 59

---

<!-- page 52 -->

Especificaciones técnicas de Servicios Web -WSFEXV1

            <FEXGetPARAM_PtoVentaResponse
         xmlns="http://ar.gov.afip.dif.fexv1/">
               <FEXGetPARAM_PtoVentaResult>
                 <FEXResultGet>
                   <ClsFEXResponse_PtoVenta>
                     <Pve_Nro>int</Pve_Nro>
                     <Pve_Bloqueado>string</Pve_Bloqueado>
                     <Pve_FchBaja>string</Pve_FchBaja>
                   </ClsFEXResponse_PtoVenta>
                   <ClsFEXResponse_PtoVenta>
                     <Pve_Nro>int</Pve_Nro>
                     <Pve_Bloqueado>string</Pve_Bloqueado>
                     <Pve_FchBaja>string</Pve_FchBaja>
                   </ClsFEXResponse_PtoVenta>
                 </FEXResultGet>
                 <FEXErr>
                   <ErrCode>int</ErrCode>
                   <ErrMsg>string</ErrMsg>
                 </FEXErr>
                 <FEXEvents>
                   <EventCode>int</EventCode>
                   <EventMsg>string</EventMsg>
                 </FEXEvents>
               </FEXGetPARAM_PtoVentaResult>
             </FEXGetPARAM_PtoVentaResponse>
           </soap:Body>
         </soap:Envelope>


Dónde:
                Campo                        Tipo                   Detalle                Obligatorio
Pve_Nro                                   Integer(N4)   Punto de venta                         S
Pve_Bloqueado                             String(C1)    Indica si el punto de venta está       S
                                                        bloqueado. De darse esta si-
                                                        tuación se deberá ingresar al
                                                        ABM de puntos de venta a re-
                                                        gularizar la situación. Valores
                                                        SoN
Pve_FchBaja                               String(C8)    Indica la fecha de baja en caso        S
                                                        de estarlo


2.14.4 Validaciones, acciones y errores
Este servicio devuelve el siguiente código de error:
                                           Código de
    Descripción de la validación                                      Mensaje de error
                                             error
Verificación de Token y Firma                1000        Usuario no autorizado        a realizar esta
                                                         operación
Cuit solicitante se encuentra entre sus      1001        Cuit solicitante no se encuentra entre sus
representados                                            representados



2.15 Recuperador de valores referenciales de códigos de Tipos de datos Opcionales
      (FEXGetPARAM_Opcionales)

2.15.1 Dirección URL
Este servicio se llama desde:
http://wswhomo.afip.gov.ar/wsfexv1/service.asmx?op= FEXGetPARAM_Opcionales

2.15.2 Mensaje de solicitud
Recibe las credenciales de autenticación, cuit del usuario representado.


                                                                                                 Página 52 de 59

---

<!-- page 53 -->

Especificaciones técnicas de Servicios Web -WSFEXV1

         <?xml version="1.0" encoding="utf-8"?>
         <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-
         instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"
         xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
           <soap:Body>
             <FEXGetPARAM_Opcionales xmlns="http://ar.gov.afip.dif.fexv1/">
               <Auth>
                 <Token>string</Token>
                 <Sign>string</Sign>
                 <Cuit>long</Cuit>
               </Auth>
             </ FEXGetPARAM_Opcionales>
           </soap:Body>
         </soap:Envelope>

Dónde:
    Campo                                 Detalle                          Obligatorio
Auth              Información de la autenticación. Contiene los datos           S
                  de Token, Sign , Cuit
Token             Token devuelto por el WSAA                                   S
Sign              Sign devuelto por el WSAA                                    S
Cuit              Cuit contribuyente (representado o Emisora)                  S
2.15.3 Mensaje de respuesta
Retorna el listado de los datos opcionales que se pueden enviar en el presente web services.
         <?xml version="1.0" encoding="utf-8"?>
         <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-
         instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"
         xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
         <soap:Body>
            <FEXGetPARAM_OpcionalesResponse
         xmlns="http://ar.gov.afip.dif.fexv1/">
               <FEXGetPARAM_OpcionalesResult>
                 <FEXResultGet>
                   <ClsFEXResponse_Opc>
                           <Opc_Id>string</Opc_Id>
                           <Opc_Ds>string</Opc_Ds>
                           <Opc_vig_desde>string</Opc_vig_desde>
                           <Opc_vig_hasta>string</Opc_vig_hasta>
                   </ClsFEXResponse_Opc>
                 </FEXResultGet>
                 <FEXErr>
                   <ErrCode>int</ErrCode>
                   <ErrMsg>string</ErrMsg>
                 </FEXErr>
                 <FEXEvents>
                   <EventCode>int</EventCode>
                   <EventMsg>string</EventMsg>
                 </FEXEvents>
               </FEXGetPARAM_OpcionalesResult>
             </FEXGetPARAM_OpcionalesResponse>
           </soap:Body>
         </soap:Envelope>


Dónde:
               Campo                       Tipo                  Detalle                 Obligatorio
                                                      Identificador  de      campo
Id                                      String (4)                                           S
                                                      opcional
                                        String
Desc                                                  Descripción                            S
                                        (250)
FchDesde                                String (8)    Fecha de vigencia desde                S


                                                                                               Página 53 de 59

---

<!-- page 54 -->

Especificaciones técnicas de Servicios Web -WSFEXV1

FchHasta                                  String (8)   Fecha de vigencia hasta                N


2.15.4 Validaciones, acciones y errores
Este servicio devuelve el siguiente código de error:
                                           Código de
    Descripción de la validación                                     Mensaje de error
                                             error
Verificación de Token y Firma                1000       Usuario no autorizado        a realizar esta
                                                        operación
Cuit solicitante se encuentra entre sus      1001       Cuit solicitante no se encuentra entre sus
representados                                           representados




2.16 Verificador de existencia de Permiso/País de destinación en bases de datos
      aduaneras (FEXCheck_Permiso)

2.16.1 Dirección URL
Este servicio se llama desde:
http://wswhomo.afip.gov.ar/wsfexv1/service.asmx?op= FEXCheck_Permiso

2.16.2 Mensaje de solicitud
Recibe las credenciales de autenticación, cuit del usuario representado, código de despacho y
país de destino y verifica la existencia en la base de datos aduanera.
         <?xml version="1.0" encoding="utf-8"?>
         <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-
         instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"
         xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
         <soap:Body>
             <FEXCheck_Permiso xmlns="http://ar.gov.afip.dif.fexv1/">
               <Auth>
                 <Token>string</Token>
                 <Sign>string</Sign>
                 <Cuit>long</Cuit>
               </Auth>
               <ID_Permiso>string</ID_Permiso>
               <Dst_merc>int</Dst_merc>
             </FEXCheck_Permiso>
         </soap:Body>
         </soap:Envelope>


Dónde:
    Campo                                  Detalle                          Obligatorio
Auth               Información de la autenticación. Contiene los datos           S
                   de Token, Sign , Cuit
Token              Token devuelto por el WSAA                                    S
Sign               Sign devuelto por el WSAA                                     S
Cuit               Cuit contribuyente (representado o Emisora)                   S


    Campo                                 Detalle                           Obligatorio
Id_Permiso         Código de permiso de embarque.                                S
Dst_merc           País de destino de la mercadería                              S


2.16.3 Mensaje de respuesta
Retorna como status OK si la información de la relación permiso de embarque/País de destinación
está registrada en la base de datos aduanera.


                                                                                                Página 54 de 59

---

<!-- page 55 -->

Especificaciones técnicas de Servicios Web -WSFEXV1

         <?xml version="1.0" encoding="utf-8"?>
         <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-
         instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"
         xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
         <soap:Body>
         <FEXCheck_PermisoResponse xmlns="http://ar.gov.afip.dif.fexv1/">
               <FEXCheck_PermisoResult>
                 <FEXResultGet>
                   <Status>string</Status>
                 </FEXResultGet>
                 <FEXErr>
                   <ErrCode>int</ErrCode>
                   <ErrMsg>string</ErrMsg>
                 </FEXErr>
                 <FEXEvents>
                   <EventCode>int</EventCode>
                   <EventMsg>string</EventMsg>
                 </FEXEvents>
               </FEXCheck_PermisoResult>
             </FEXCheck_PermisoResponse>
           </soap:Body>
         </soap:Envelope>




Dónde:
                Campo                       Tipo                   Detalle                Obligatorio
Status                                                 De verificar existencia retorna-
                                          String(C2)                                           S
                                                       ra “OK” caso contrario “NO”


2.16.4 Validaciones, acciones y errores
Este servicio devuelve el siguiente código de error:
                                          Código de
    Descripción de la validación                                      Mensaje de error
                                            error
Verificación de Token y Firma               1000        Usuario no autorizado        a realizar esta
                                                        operación
Cuit solicitante se encuentra entre sus     1001        Cuit solicitante no se encuentra entre sus
representados                                           representados
Campo mandatario + Relación                 1810        En caso de omisión de alguno de los
Permiso/Pais                                            campos de ingreso.

                                                        En caso de no existir el país registrado en
                                                        nuestras bases.

2.17 Método Dummy para verificación de funcionamiento de infraestructura
      (FEXDummy)

2.17.1 Dirección URL
Este servicio se llama desde:
http://wswhomo.afip.gov.ar/wsfexv1/service.asmx?op= FEXDummy

2.17.2 Mensaje de solicitud
El método no posee parámetros de ingreso
         <?xml version="1.0" encoding="utf-8"?>
         <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-
         instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"
         xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
           <soap:Body>


                                                                                                Página 55 de 59

---

<!-- page 56 -->

Especificaciones técnicas de Servicios Web -WSFEXV1

            <FEXDummy xmlns="http://ar.gov.afip.dif.fexv1/" />
          </soap:Body>
         </soap:Envelope>




2.17.3 Mensaje de respuesta
Retorna la comprobación vía “ping” de los elementos principales de infraestructura del servicio.
         <?xml version="1.0" encoding="utf-8"?>
         <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-
         instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"
         xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
         <soap:Body>
             <FEXDummyResponse xmlns="http://ar.gov.afip.dif.fexv1/">
               <FEXDummyResult>
                 <AppServer>string</AppServer>
                 <DbServer>string</DbServer>
                 <AuthServer>string</AuthServer>
               </FEXDummyResult>
             </FEXDummyResponse>
           </soap:Body>
         </soap:Envelope>




Dónde:
               Campo                       Tipo                  Detalle               Obligatorio
AppServer                              String(C2)     Servidor de aplicaciones               S
DbServer                               String(C2)     Servidor de base de datos              S
AuthServer                             String(C2)     Servidor de autenticación              S



2.18 Margen de error mediante (Error Absoluto y Error Relativo)




       Error Absoluto eabs: Es la diferencia entre el valor medido (calculado) y el valor real

       Error Relativo erel : Es el cociente entre el valor error absoluto y el valor real.

       En ambos casos se tomará el valor absoluto, es decir el signo resultante de la operación
       no se considerará.

       El criterio de redondeo que utilizamos en este servicio es Round Half Even.




                                                                                             Página 56 de 59

---

<!-- page 57 -->

Especificaciones técnicas de Servicios Web -WSFEXV1

2.19 Recuperador de valores referenciales de códigos de Moneda
      (FEXGetPARAM_MON_CON_COTIZACION)

2.19.1 Dirección URL
Este servicio se llama desde:
http://wswhomo.afip.gov.ar/wsfexv1/service.asmx?op=
      FEXGetPARAM_MON_CON_COTIZACION

2.19.2 Mensaje de solicitud
Recibe las credenciales de autenticación y la cuit del usuario representado y la fecha a consultar
las cotizaciones aduaneras.


   <?xml version="1.0" encoding="utf-8"?><soap:Envelope
   xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
   xmlns:xsd="http://www.w3.org/2001/XMLSchema"
   xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
     <soap:Body>
       <FEXGetPARAM_MON_CON_COTIZACION xmlns="http://ar.gov.afip.dif.fexv1/">
         <Auth>
           <Token>string</Token>
           <Sign>string</Sign>
           <Cuit>long</Cuit>
         </Auth>
         <Fecha>string</Fecha>
       </FEXGetPARAM_MON_CON_COTIZACION>
     </soap:Body></soap:Envelope>

Dónde:


    Campo                                 Detalle                       Obligatorio
Auth              Información de la autenticación. Contiene los datos        S
                  de Token, Sign , Cuit
Token             Token devuelto por el WSAA                                S
Sign              Sign devuelto por el WSAA                                 S
Cuit              Cuit contribuyente (representado o Emisora)               S
Fecha             Fecha día hábil a la cual se consulta las monedas
                                                                            S
                  disponibles y sus cotizaciones (yyyymmdd)


2.19.3 Mensaje de respuesta
Retorna la cotización a la fecha consultada de la base de datos aduanera de todas las monedas
que posean cotización a la fecha indicada.
   <?xml version="1.0" encoding="utf-8"?>
   <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
   xmlns:xsd="http://www.w3.org/2001/XMLSchema"
   xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
     <soap:Body>
       <FEXGetPARAM_MON_CON_COTIZACIONResponse
   xmlns="http://ar.gov.afip.dif.fexv1/">
         <FEXGetPARAM_MON_CON_COTIZACIONResult>
           <FEXResultGet>
             <ClsFEXResponse_Mon_CON_Cotizacion>
               <Mon_Id>string</Mon_Id>
               <Mon_ctz>decimal</Mon_ctz>
               <Mon_fecha>string</Mon_fecha>
             </ClsFEXResponse_Mon_CON_Cotizacion>
           </FEXResultGet>
           <FEXErr>
             <ErrCode>int</ErrCode>
             <Errmsg>string</Errmsg>


                                                                                      Página 57 de 59

---

<!-- page 58 -->

Especificaciones técnicas de Servicios Web -WSFEXV1

           </FEXErr>
           <FEXEvents>
             <EventCode>int</EventCode>
             <EventMsg>string</EventMsg>
           </FEXEvents>
         </FEXGetPARAM_MON_CON_COTIZACIONResult>
       </FEXGetPARAM_MON_CON_COTIZACIONResponse>
     </soap:Body></soap:Envelope>


Dónde:
                 Campo                       Tipo                   Detalle
Mon_id                                    String(C3)   Código de moneda
Mon_ctz                                   Decimal
                                                       Cotización de la moneda
                                          (N12,6)
Fecha_ctz                                 String(C8)   Fecha de la cotización


2.19.4 Validaciones, acciones y errores
Este servicio devuelve el siguiente código de error:
                                          Código de
    Descripción de la validación                                    Mensaje de error
                                            error
Verificación de Token y Firma               1000       Usuario no autorizado       a realizar esta
                                                       operación
Cuit solicitante se encuentra entre sus     1001       Cuit solicitante no se encuentra entre sus
representados                                          representados
Verificacion del campo Fecha_CTZ            2054       El campo Fecha_CTZ es de integración
                                                       obligatoria y debe tener el siguiente formato:
                                                       YYYYMMDD


2.20 Recupera el listado de las diferentes actividades habilitadas para el emisor
      (FEXGetPARAM_Actividades)

2.20.1 Dirección URL
Este servicio se llama desde:
http://wswhomo.afip.gov.ar/wsfexv1/service.asmx?op= FEXGetPARAM_Actividades

2.20.2 Mensaje de solicitud
Recibe las credenciales de autenticación y la cuit del usuario representado con el fin de obtener
sus actividades.


    <?xml version="1.0" encoding="utf-8"?><soap:Envelope
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xmlns:xsd="http://www.w3.org/2001/XMLSchema"
    xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
      <soap:Body>
        <FEXGetPARAM_Actividades xmlns="http://ar.gov.afip.dif.fexv1/">
          <Auth>
            <Token>string</Token>
            <Sign>string</Sign>
            <Cuit>long</Cuit>
          </Auth>
        </ FEXGetPARAM_Actividades>
      </soap:Body></soap:Envelope>

Dónde:



                                                                                               Página 58 de 59

---

<!-- page 59 -->

Especificaciones técnicas de Servicios Web -WSFEXV1
    Campo                                  Detalle                           Obligatorio
Auth               Información de la autenticación. Contiene los datos            S
                   de Token, Sign , Cuit
Token              Token devuelto por el WSAA                                     S
Sign               Sign devuelto por el WSAA                                      S
Cuit               Cuit contribuyente (representado o Emisora)                    S


2.20.3 Mensaje de respuesta
Retorna las actividades del emisor a la fecha consultada
     <?xml versión=”1.0” encoding="utf-8"?>
     <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
     xmlns:xsd="http://www.w3.org/2001/XMLSchema"
     xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
       <soap:Body>
         <FEXGetPARAM_ActividadesResponse xmlns="http://ar.gov.afip.dif.fexv1/">
           <FEXGetPARAM_ActividadesResult>
             <FEXResultGet>
               <ClsFEXResponse_ActividadTipo>
                 <Id>string</Id>
                 <Orden>decimal</Orden>
                 <Desc>string</Desc>
               </ClsFEXResponse_ActividadTipo>
             </FEXResultGet>
             <FEXErr>
               <ErrCode>int</ErrCode>
               <Errmsg>string</Errmsg>
             </FEXErr>
             <FEXEvents>
               <EventCode>int</EventCode>
               <EventMsg>string</EventMsg>
             </FEXEvents>
           </FEXGetPARAM_ActividadesResult>
         </FEXGetPARAM_ActividadesResponse>
       </soap:Body></soap:Envelope>


Dónde:
                 Campo                        Tipo                    Detalle
Id                                         Long          Identificador de la actividad
Orden                                      Short         Orden de la actividad
Desc                                       String(180)   Descripción de la actividad


2.20.4 Validaciones, acciones y errores
Este servicio devuelve el siguiente código de error:
                                          Código de
     Descripción de la validación                                     Mensaje de error
                                            error
Verificación de Token y Firma               1000         Usuario no autorizado         a realizar esta
                                                         operación
Cuit solicitante se encuentra entre sus      1001        Cuit solicitante no se encuentra entre sus
representados                                            representados




                                                                                                 Página 59 de 59
