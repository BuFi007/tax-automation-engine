# WSFEV1 — Factura Electrónica (COMPG) — Manual para el desarrollador V.4.5 (R.G. N° 4.291)

> **Source (authoritative):** https://www.arca.gob.ar/ws/documentacion/manuales/manual-desarrollador-ARCA-COMPG.pdf
> **Retrieved:** 2026-07-15
> **Conversion:** local `pdftotext -layout` extraction of the official PDF (199 pages, Last-Modified 2026-07-03).
>
> **WARNING:** This markdown is a convenience copy for search/reference only. The
> official PDF at the source URL is the authoritative document. Exact-recovery
> details and fiscal rules MUST be verified against the PDF before implementation.

<!-- page 1 -->

     Manuales para el desarrollador


     Facturación

                        RG 4291 – Proyecto FE v4.5



Agencia de Recaudación y Control Aduanero
Subdirección General de Sistemas y
Telecomunicaciones
ARCA-SDG SIT



      Revisión correspondiente al 2 de Julio de 2026

---

<!-- page 2 -->

                    Historial de modificaciones

Ver   Fecha      Edición         Descripción


0.1   08-09-2010 SDG SIT/DIF     Versión inicial del documento
                                 Se agrega ítem 1.5 con Dirección URL de Homologa-
1.1   18-03-2011 SDG SIT/DIF     ción y Producción del ws.

                                 Se agrega el punto “Operaciones a realizar según la
                                 RG de aplicación.” En este se indica que métodos se
                                 utilizan para CAE y cuales para CAEA

                                 Mejora en el detalle de los objetos necesarios envia-
                                 dos en un request.

                                 Mejora en la descripción de las validaciones de nego-
                                 cio y exposición de los campos.

                                 Se permite como receptor del comprobante a sujetos
                                 identificados como no categorizados.

                                 En método FECAESolicitar y FECAEARegInformativo:
                                 se corrigen leyendas sobre códigos de error, se agre-
                                 gan nuevas validaciones.

                                 Se agrega lógica a los datos informados sobre el ele-
                                 mento “Opcionales” de los métodos FECAESolicitar y
                                 FECAEARegInformativo.

                                 Se corrige precisión en las definiciones de los atributos
                                 enviados en los request y response.

                                 Se mejora la descripción de la operatoria ante errores
                                 y se agregan ejemplos para FECAEARegInformativo.

                                 Con el fin de guiar al desarrollador sobre los cambios
                                 impactados en el presente release se adjunta ANEXO
                                 1 a modo descriptivo sobre los códigos de errores que
                                 el nuevo relese soporta.

---

<!-- page 3 -->

                               Se agrega funcionalidad y se adaptan los métodos pú-
2.0   15-04-2011 SDG SIT/DIF   blicos con el fin de soportar comprobantes tipo “C” se-
                               gún Resolución General AFIP Nº 3067/2011.

                               A quienes tengan que desarrollar el cliente consumidor
                               del servicio para informar comprobantes tipo “C” con-
                               sultar ANEXO 2.

                               Error en la documentación del Relese 1.1. Se mueve el
                               código 1413 de la grilla de excluyentes a no excluyen-
                               tes.
                               Comprobante Bienes Usados
2.1   22-07-2013 SDG SIT/DIF
                               Se agrega validación sobre el código 10000, empadro-
                               namiento en bienes usados.

                               Se agregan los código 10075, 10076, 10077, 10078,
                               10079, 10080, 10081, 10082, 10083, 10084, 10085.

                               Se modifican los código 10007, 10012, 10015, 10043,
                               10044, 10045, 10047, 10048, 10068
                               Comprobante Bienes Usados
2.2   03-10-2014 SDG SIT/DIF
                               Se reemplazan los códigos Opcionales 51, 52 y 53 por
                               91, 92 y 93 respectivamente.

                               Por el cambio de códigos Opcionales se modifican las
                               descripciones de las validaciones de los códigos
                               10077, 10078 ,10079 ,10080 ,10081 ,10082 ,10083
                               ,10084, 10085
                               Se adaptan los métodos públicos con el fin de incorpo-
2.3   09-10-2014 SDG SIT/DIF   rar las alícuotas identificadas en la Ley 26982.


                               Se adaptan los métodos públicos con el fin de incorpo-
2.4   22-10-2014 SDG SIT/DIF   rar mediante códigos Opcionales lo expuesto en la Re-
                               solución General 3668

                               Se agregan los códigos: 10086, 10087, 10088, 10089,
                               10090, 10091, 10092, 10093, 10094, 10095
                               Se adaptan los métodos públicos con el fin de incorpo-
2.5   01-04-2014 SDG SIT/DIF   rar la autorización de comprobantes C a los contribu-
                               yentes exentos en el impuesto.

                               Se agregan los códigos 10096

---

<!-- page 4 -->

                               Se adaptan los métodos públicos con el fin de incorpo-
2.6   01-07-2015 SDG SIT/DIF   rar los comprobantes tipo M y los códigos de opciona-
                               les según la Resolución General 3749.

                               Se modifican los códigos 10066 y 1100.

                               Para comprobantes M se modificaron los sig. códigos:

                               10000, 10007, 10012, 10013, 10017, 10019, 10020,
                               10021, 10040, 10051, 10061, 10063, 10068

                               Para dar soporte a RG3749 se dan de alta los sig. có-
                               digos:
                               10097, 10098, 10099, 10110, 10111, 10112, 10113, 10114,
                               10115

                               Se agrega la descripción de la validación 1427.
                               Se agrega la validación 1428.

                               Se agrega información sobre canales de atención y sitios de
                               consultas
                               Código 10017. Por error de documentación se en-
2.7   01-01-2016 SDG SIT/DIF   contraba dentro del grupo de las validaciones exclu-
                               yentes.

                               Para dar soporte a RG3779 se dan de alta los sig. có-
                               digos:

                               10116, 10117, 10118
                               Se agrega estructura <Observaciones> dentro de <FE-
2.8   01-09-2016 SDG SIT/DIF   CAEASolicitarResult><ResultGet> para soportar códi-
                               gos de observación al momento de solicitar un CAEA.

                               Alta del código 15100 como validación no excluyente
                               al momento de solicitar un CAEA.

                               Alta de los códigos 1429, 1430, 1431 como validacio-
                               nes no excluyentes al momento de informar un com-
                               probante.

                               Baja del código 1428, 15013
                               Se modifican los códigos 10040, 806, 807
2.9   13-03-2017 SDG SIT/DIF
                               Se dan de alta los códigos 10119, 10120, 10121,
                               10122, 808, 809, 810 y 811 comprobantes asociados
                               88, 991.

                               Para dar soporte a la RG 4004-E se dan de alta los
                               sig. códigos: 10123, 10124, 10125, 10126, 10127,
                               10128, 10129, 10130, 10131, 10132 y se modifican los
                               sig. 10040, 10054, 10112

---

<!-- page 5 -->

                                  Se agrega estructura de Compradores para dar sopor-
2.10   09/08/2017   SDG SIT/DIF   te a receptores múltiples. Los códigos para dar soporte
                                  a esta nueva estructura van de 10133 al 10150

                                  Se agrega en el manual la validación correspondiente
                                  al código 10119 y 10070.

                                  Se da de alta el código 11002.

                                  Se agrega la validación 10151 para cuando envía cuit
                                  en comprobantes asociados.

                                  Se agrega la validación 1432 con el fin de limitar el in-
                                  greso de compradores múltiples por régimen informati-
                                  vo de CAEA.


                                  Se habilita autorización de comprobantes C mediante
2.11   01/08/2018   SDG SIT/DIF   la modalidad CAEA según RG 4291.

                                  Se modifica el período de solicitud del CAEA. Se agre-
                                  ga opción para solicitarlo dentro de cada quincena.

                                  Se modifican las validaciones de los códigos 1417,
                                  1418, 1419, 1422, 10014, 10015 con el fin de dar so-
                                  porte a todos los comprobantes B > a $10000 según
                                  RG 4291. La validación de $10000, será la resultante
                                  de importe total * cotización. En caso de mon_id = PES
                                  la cotización siempre es =1.

                                  Se modifica el código 700, se agregan recibos tipo A,
                                  B, C y M

                                  Se modifica el código 1404 se agregan comprobantes
                                  tipos B y C

                                  Se modifica el código 1405, se agregan comprobantes
                                  tipo C

                                  Baja de los códigos 1430, 15100

                                  Se modifican las validaciones 15006, 15010

                                  Se agregan validaciones desde el código 1433 al
                                  1445.

                                  Se agregan las sig. validaciones
                                  10152,10071,15015,15014.

                                  Se da de baja la validación 15007

---

<!-- page 6 -->

2.12                                Se amplía el campo punto de venta de numérico de 4
         01/10/2018   SDG SIT/DIF   a numérico de 5 a partir del dia 01/10/2018.

                                    Se modifica estructura del mensaje de respuesta del méto-
                                    do público FEParamGetPtosVenta, atributo PtoVen-
                                    ta.<soap:Body><FEParamGetPtosVentaResponse><FEPara-
                                    mGetPtosVentaResult><ResultGet><PtoVenta><Nro> de
                                    short a int.

                                    Se modifica la estructura general de los mensajes de
                                    respuesta incluyendo información adicional al header
                                    del response (ver punto 1.4).
                                    Se modifican las validaciones de los sig. Códigos 1206, 1300,
                                    10004, 10101, 11000.

                                    Se modifica la validación 10119, pasa de 50% a un
                                    20%.
                                    Se agregan comprobantes “Factura de Crédito”
2.13 –   01/11/2018   SDG SIT/DIF
Beta 1                              Se modifican los sig. códigos para modalidad de auto-
                                    rización CAE:

                                    10000, 10003, 10007, 10015, 10016, 10040, 10042,
                                    10068, , 10151, 10152

                                    Se dan de alta los sig. códigos para modalidad de au-
                                    torización CAE:

                                    10153, 10154, 10155, 10156, 10157, 10158, 10159,
                                    10160, 10161, 10162, 10163, 10164, 10165, 10166,
                                    10167, 10168, 10169, 10170, 10171, 10172, 10173,
                                    10174, 10175, 10176, 10177, 10178, 10179, 10180,
                                    10181, 10182, 10183, 10184, 10185

                                    Se modifican los sig. códigos para modalidad de auto-
                                    rización CAEA:

                                    Se dan de alta los sig. códigos para modalidad de au-
                                    torización CAEA:

---

<!-- page 7 -->

                                    Se agregan declaraciones sobre el campo CbteFch,
2.13 –   16/01/2019   SDG SIT/DIF   FchVtoPago
Beta 2
                                    Se agregan observaciones sobre el campo CbtesAso-
                                    c.CbteFch

                                    Se da baja la validación 10000 orden 12, 10179, 10182

                                    Se modifica validación 10000 orden 4

                                    Se modifica la validación 10016, 10040, 10184, 10185

                                    Se dan de alta los códigos 10186, 10187, 10188
                                    Se agrega referencia comercial para dar soporte a fac-
2.13     11/03/2019   SDG SIT/DIF   turas de crédito mediante campo en estructura <Opcio-
                                    nales>

                                    Se dan de alta los códigos 10189, 10190, 10191,
                                    10192

                                    Se modifican las validaciones 10154, 10169, 10170
                                    Se da de alta la validación 10193
2.14     01/05/2019   SDG SIT/DIF   Se da de baja la validación 10185

                                    Se modifican las validaciones de los códigos 1415,
                                    1417, 1418, 1419, 1422, 10014, 10015 con el fin de
                                    dar soporte a todos los comprobantes B > a $10000
                                    según Resolución General 4444/2019. La validación
                                    de $10000, será la resultante de importe total * cotiza-
                                    ción. En caso de mon_id = PES la cotización siempre
                                    es =1.
                                    Se da de alta el código 10194 para modalidad de auto-
2.15     01/07/2019   SDG SIT/DIF   rización CAE.

                                    Se modifican los sig. códigos para modalidad de auto-
                                    rización CAEA: 10003, 700, 711, 807, 808

                                    Se dan de alta los sig. códigos para modalidad de au-
                                    torización CAEA: 812, 813, 1446, 1450, 1451, 1452,
                                    1453, 1454, 1455, 1456, 1457, 1458, 1459, 1460,
                                    1461, 1462, 1463, 1464, 1465, 1466, 1467, 1468,
                                    1469, 1470, 1471, 1472, 1474, 1475, 1476, 1477,
                                    1478, 1479, 1480, 1481, 1482, 1483, 1486, 1487, 1488
                                    Se da de alta el código 10195 para modalidad de auto-
2.16     01/11/2019   SDG SIT/DIF   rización CAE.

                                    Se da de alta el código 1489 para modalidad de autori-
                                    zación CAEA.

---

<!-- page 8 -->

                                    Se modifica validación sobre los topes de facturación
2.17     26/02/2020   SDG SIT/DIF   con el fin de aplicar las adecuaciones indicadas en la
                                    Resolución General AFIP N° 4444/2019.

                                    Los códigos que se modifican son: 1415, 1417, 1418,
                                    1419, 1422, 10014, 10015.
                                    ADECUACIONES RESOLUCIÓN GENERAL N°
2.18 –   01/05/2020   SDG SIT/DIF   4.540/2019
Beta 1
                                    Se agrega estructura PeriodoAsoc para los métodos
                                    FECAEARegInformativo, FECAESolicitar, FEComp-
                                    Consultar.

                                    Para modalidad de autorización con CAE, se dan de
                                    alta los códigos del 10196 al 10199 y del 10203 al
                                    10213

                                    Para la modalidad de autorización con CAEA, se dan
                                    de alta los códigos del 1490 al 1504
                                    ADECUACIONES RESOLUCIÓN GENERAL N°
2.18     18/06/2020   SDG SIT/DIF   4.540/2019

                                    Para CAE, código 10209 pasa de rechazar a observar.

                                    Para CAEA, código 1500 pasa de rechazar a observar.
                                    Adecuación para que el campo opcional 23 – Referen-
2.19     19/10/2020   SDG SIT/DIF   cia Comercial deje de ser exclusivo para Facturas de
                                    Crédito, ahora se puede usar para el resto de los com-
                                    probantes habilitados. Para CAE se modifica valida-
                                    ción del código 10169, 10189. Para CAEA se modifica
                                    validación del código 1466, 1482

                                    Para la modalidad de autorización CAEA, se adaptan
                                    los métodos públicos con el fin de incorporar mediante
                                    códigos Opcionales lo expuesto en la Resolución Ge-
                                    neral 3668. Se agregan los códigos: 1505, 1506, 1507,
                                    1508, 1509, 1510, 1511, 1512

                                    Se dan de baja los códigos 10087, 10093

                                    Para la modalidad CAE el código 10195 pasa de ob-
                                    servar a rechazar cuando el receptor del comprobante
                                    se encuentra en condición de apócrifo a la fecha de
                                    autorización del comprobante.

---

<!-- page 9 -->

                                  Para la modalidad de autorización CAE y CAEA, se adaptan
2.20   29/01/2021   SDG SIT/DIF   los métodos públicos con el fin de incorporar mediante
                                  códigos Opcionales y solo para las facturas de crédito el
                                  identificar que representa si se transfiere al sistema de
                                  circulación abierta o al agente de depósito colectivo.

                                  Para CAE

                                  Se modifican los códigos 10169, 10170 y 10172

                                  Se dan de alta los códigos 10214, 10215 y 10216

                                  Para CAEA

                                  Se modifican los códigos 1466, 1467, 1469

                                  Se dan de alta los códigos 1513, 1514, 1515
                                  ADECUACIONES LEY 27.618 “REGIMEN DE SOSTENIMIENTO
2.21   01/06/2021   SDG SIT/DIF   E INCLUSIÓN FISCAL PARA PEQUEÑOS COTRIBUYENTES”

                                  Para CAE, se modifica el código 10063, 10149, 10177

                                  Se da de alta el código 10217.

                                  Para CAEA, se modifica el código 1402, 1474

                                  Se da de alta el código 1516.

                                  Para CAE 10177
2.22   07/09/2021   SDG SIT/DIF
                                  Para CAEA 1474

---

<!-- page 10 -->

                                    Según la RG 5259/2022 de remitos Cárnicos y la RG
3.0 –    15/10/2022   SDG SIT/DIF   5264/2022 de remitos Harinero, procedemos a hacer
Beta 1                              las adecuaciones del servicio mediante las sig. actuali-
                                    zaciones:

                                    Se agrega un método público “FEParamGetActivida-
                                    des“, que permite determinar todas las actividades vi-
                                    gentes del emisor del comprobante.

                                    Se agrega para CAE y para CAEA una estructura de
                                    actividades vinculadas al comprobante tanto en la emi-
                                    sión de CAE, en el régimen de información de CAEA y
                                    en las consultas de los comprobantes ya autorizados.

                                    Se agregan una lista de códigos con validaciones con
                                    el objetivo de controlar las actividades y los remitos
                                    asociados según corresponda. Ver Anexo

                                    Para CAE, se dan de alta los sig. códigos

                                    10218, 10219, 10220, 10221, 10222, 10223, 10224,
                                    10225, 10226, 10227, 10228, 10229, 10230, 10231,
                                    10232

                                    De obtenerse los sig. códigos de validación:
                                    10225,10226,10227,10228,10229,10230,10231

                                    Si la actividad es Cárnica y la fecha de emisión se en-
                                    cuentra comprendida entre el 15/11/2022 y el
                                    14/12/2022 los códigos SOLO observan el comproban-
                                    te. Con fecha igual o posterior al 15/12/2022 los com-
                                    probantes pasan a quedar rechazados.

                                    Si la actividad es Harina y la fecha de emisión se en-
                                    cuentra comprendida entre el 01/02/2023 y el
                                    28/02/2023 los códigos SOLO observan el comproban-
                                    te. Con fecha igual o posterior al 01/03/2023 los com-
                                    probantes pasan a quedar rechazados.

                                    Para CAEA, se dan de alta los sig. códigos

                                    16000, 16001, 16002, 16003, 16004, 16005, 16006,
                                    16007, 16008, 16009, 16010, 16011, 16012, 16013,
                                    16014

                                    Se modifican los siguientes códigos: Para CAE: 10120,
                                    10121, 10122. Para CAEA: 806, 809, 810, 811

---

<!-- page 11 -->

                                 Según la RG 5259/2022 de remitos Cárnicos y la RG
3.0   01/12/2022   SDG SIT/DIF   5264/2022 de remitos Harinero, procedemos a hacer
                                 las adecuaciones del servicio mediante las sig. actuali-
                                 zaciones:

                                 Se agrega un método público “FEParamGetActivida-
                                 des“, que permite determinar todas las actividades vi-
                                 gentes del emisor del comprobante.

                                 Se agrega para CAE y para CAEA una estructura de
                                 actividades vinculadas al comprobante tanto en la emi-
                                 sión de CAE, en el régimen de información de CAEA y
                                 en las consultas de los comprobantes ya autorizados.

                                 Se agregan una lista de códigos con validaciones con
                                 el objetivo de controlar las actividades y los remitos
                                 asociados según corresponda. Ver Anexo

                                 Para CAE, se dan de alta los sig. códigos

                                 10218, 10219, 10220, 10221, 10222, 10223, 10224,
                                 10225, 10226, 10227, 10228, 10229, 10230, 10231,
                                 10232

                                 De obtenerse los sig. códigos de validación:
                                 10225,10226,10227,10228,10229,10230,10231

                                 Si la actividad es Cárnica y la fecha de emisión se en-
                                 cuentra comprendida entre el 15/11/2022 y el
                                 14/12/2022 los códigos SOLO observan el comproban-
                                 te. Con fecha igual o posterior al 15/12/2022 los com-
                                 probantes pasan a quedar rechazados.

                                 Si la actividad es Harina y la fecha de emisión se en-
                                 cuentra comprendida entre el 01/02/2023 y el
                                 28/02/2023 los códigos SOLO observan el comproban-
                                 te. Con fecha igual o posterior al 01/03/2023 los com-
                                 probantes pasan a quedar rechazados.

                                 Para CAEA, se dan de alta los sig. códigos

                                 16000, 16001, 16002, 16003, 16004, 16005, 16006,
                                 16007, 16008, 16009, 16010, 16011, 16012, 16013,
                                 16014

                                 Se modifican los siguientes códigos: Para CAE: 10120,
                                 10121, 10122. Para CAEA: 806, 809, 810, 811
                                 Se modifica validación 10119. El tipo de cambio no po-
3.1   01/01/2023   SDG SIT/DIF   drá ser inferior al 20% ni superior en un 200% del que
                                 suministra ARCA como orientativo de acuerdo a la co-
                                 tización oficial.

---

<!-- page 12 -->

                                 Se modifica validación 10119. El tipo de cambio no po-
3.2   12/12/2023   SDG SIT/DIF   drá superior en un 400% del que suministra ARCA
                                 como orientativo de acuerdo a la cotización oficial.

                                 Se modifica validación 10119. El tipo de cambio no po-
3.3   04/01/2024   SDG SIT/DIF   drá ser inferior al 2% ni superior en un 400% del que
                                 suministra ARCA como orientativo de acuerdo a la co-
                                 tización oficial.

                                 Adecuaciones en el sistema de alertas y monitoreo en
                                 la emisión de comprobantes.

                                 Para CAE, se dan de alta los siguientes códigos:
                                 10234, 10235, 10236

                                 Para CAEA, se dan de alta los siguientes códigos: 814,
                                 815, 816, 817
                                 Adecuaciones en el sistema de alertas y monitoreo en
3.4   17/05/2024   SDG SIT/DIF   la emisión de comprobantes.

                                 Para CAE, se dan de alta los siguientes códigos:
                                 10237, 10238

                                 Para CAEA, se dan de alta los siguientes códigos: 818,
                                 819

---

<!-- page 13 -->

4.0   17/03/2025   SDG SIT/DIF   Se agregan los siguientes campos nuevos:

                                 <CanMisMonExt>

                                 <CondicionIVAReceptorId>

                                 Asimismo se agregan los siguientes códigos de erro-
                                 res/observaciones:

                                 Para CAE, se dan de alta los siguientes códigos:
                                 10239, 10240, 10241,10242, 10243, 10245, 10246

                                 Para CAEA, se dan de alta los siguientes códigos: 820,
                                 821, 822, 823, 824, 825, 826

                                 Se modifica el código de error: para CAE 10038 y para
                                 CAEA 726 correspondiente al campo MonCotiz. Si se
                                 indica que el pago del comprobante se realiza en la
                                 misma moneda extranjera que la factura, la cotización
                                 de la moneda provista debe coincidir exactamente con
                                 la registrada en las bases de ARCA para el día hábil
                                 anterior a la fecha de emisión del comprobante, si esta
                                 es anterior a la fecha actual, o bien con la registrada
                                 para el día hábil anterior a la fecha actual, si la fecha
                                 de emisión es posterior a esta. En caso contrario, se
                                 puede omitir el campo de Cotización de Moneda.

                                 Se modifica el método “FEParamGetCotizacion”, agre-
                                 gando de forma opcional la fecha de la cotización a
                                 querer consultar. Se agrega el código de error 12002
                                 para validar el nuevo campo.

                                 También se agrega nuevo método "FEParamGetCon-
                                 dicionIvaReceptor" para recuperar los valores de refe-
                                 rencia de los códigos correspondientes a la condición
                                 de IVA del receptor. Se agrega el código de error
                                 10244 en la validación de dicho método.

                                 A partir del 6 de abril de 2025 podrá enviarse de forma
                                 opcional el campo Condición Frente al IVA del recep-
                                 tor, hasta tanto entre en vigencia su obligatoriedad re-
                                 glamentada por la Resolución General N°5616, en
                                 cuyo momento pasará a rechazar la emisión de com-
                                 probantes sin este dato.

---

<!-- page 14 -->

                                 Adecuaciones para el reemplazo de comprobantes cla-
4.1   01/12/2025   SDG SIT/DIF   se M.
                                 Se modifica el método FEParamGetCondicionIvaRe-
                                 ceptor
                                 También modifica la descripción de los siguientes códi-
                                 gos de error / observación: 814, 815, 1444, 1516,
                                 10000, 10007, 10012, 10013, 10017, 10061, 10063,
                                 10149, 10217, 10234, 10244.
                                 Se agregan validaciones al modulo de alertas y moni-
4.2   01/02/2026   SDG SIT/DIF   toreo en la emisión de comprobantes.

                                 Para CAE, se dan de alta los siguientes códigos:
                                 10247, 10248, 10249

                                 Para CAEA, se dan de alta los siguientes códigos: 827,
                                 828, 829.
                                 Adecuaciones para la estructura de opcionales de los
4.3   01/06/2026   SDG SIT/DIF   comprobantes tipo 63 y 64. Se agregan los siguientes
                                 códigos de validación para la modalidad CAEA: 1517,
                                 1518, 1519, 1520, 1521, 1522, 1523, 1524, 1525,
                                 1526.

                                 También se modifican los siguientes códigos: Para
                                 CAE:10068 y para CAEA: 700, 807, 1426, 15000.

                                 Por último el código 15001 quedará en desuso.

                                 Adecuaciones para la emisión de comprobantes por
4.4   01/07/2026   SDG SIT/DIF   Entidades Financieras y Seguros, en cumplimiento
                                 con la RG 5866. Para la modalidad CAE se agregó
                                 el código de validación 10251.

                                 Para entidades financieras se agrega tipo de docu-
4.5   02/07/2026   SDG SIT/DIF   mento receptor "31 - Fondo Común de Inversiones
                                 CNV". Para la modalidad CAE se agregan los siguien-
                                 tes códigos de validación 10270,10271 y 10272.

---

<!-- page 15 -->

                                                                     Contenido
INTRODUCCIÓN.................................................................................................................................................17
ALCANCE.........................................................................................................................................................17
AUTENTICACIÓN...............................................................................................................................................17
ESTRUCTURA GENERAL DEL MENSAJE DE RESPUESTA (RESPONSE)...............................................................................17
TRATAMIENTO DE ERRORES EN EL WS...................................................................................................................18
TRATAMIENTO DE EVENTOS.................................................................................................................................19
DIRECCIÓN URL...............................................................................................................................................20
CANALES DE ATENCIÓN......................................................................................................................................20
SITIOS DE CONSULTA..........................................................................................................................................20
WS DE NEGOCIO..............................................................................................................................................22
OPERACIONES..................................................................................................................................................22
MÉTODO DE AUTORIZACIÓN DE COMPROBANTES ELECTRÓNICOS POR CAE (FECAESOLICITAR).......................................23
 DIRECCIÓN URL (HOMOLOGACIÓN)....................................................................................................................23
MENSAJE DE SOLICITUD.....................................................................................................................................23
MENSAJE DE RESPUESTA....................................................................................................................................34
VALIDACIONES Y ERRORES..................................................................................................................................37
OPERATORIA ANTE ERRORES...............................................................................................................................71
EJEMPLOS........................................................................................................................................................72
MÉTODO DE OBTENCIÓN DE CAEA (FECAEASOLICITAR).........................................................................................85
DIRECCIÓN URL (HOMOLOGACIÓN)....................................................................................................................85
MENSAJE DE SOLICITUD.....................................................................................................................................85
MENSAJE DE RESPUESTA....................................................................................................................................86
VALIDACIONES Y ERRORES..................................................................................................................................88
EJEMPLO SIN OBSERVACIONES:...........................................................................................................................89
EJEMPLO CON OBSERVACIONES:..........................................................................................................................90
MÉTODO DE CONSULTA DE CAEA (FECAEACONSULTAR)........................................................................................91
DIRECCIÓN URL (HOMOLOGACIÓN)....................................................................................................................91
MENSAJE DE SOLICITUD.....................................................................................................................................91
MENSAJE DE RESPUESTA....................................................................................................................................92
VALIDACIONES, ACCIONES Y ERRORES...................................................................................................................94
EJEMPLO:........................................................................................................................................................94
RECUPERADOR DE VALORES REFERENCIALES DE CÓDIGOS DE TIPOS DE COMPROBANTE (FEPARAMGETTIPOSCBTE).............95
DIRECCIÓN URL (HOMOLOGACIÓN)....................................................................................................................95
MENSAJE DE SOLICITUD.....................................................................................................................................95
MENSAJE DE RESPUESTA....................................................................................................................................96
RECUPERADOR DE VALORES REFERENCIALES DE CÓDIGOS DE TIPOS DE CONCEPTOS (FEPARAMGETTIPOSCONCEPTO).........97
ESTE MÉTODO DEVUELVE LOS TIPOS DE CONCEPTOS POSIBLES EN ESTE WS.................................................................97
DIRECCIÓN URL (HOMOLOGACIÓN)....................................................................................................................97
MENSAJE DE SOLICITUD.....................................................................................................................................97
MENSAJE DE RESPUESTA....................................................................................................................................98
RECUPERADOR DE VALORES REFERENCIALES DE CÓDIGOS DE TIPOS DE DOCUMENTOS (FEPARAMGETTIPOSDOC)..............99
DIRECCIÓN URL (HOMOLOGACIÓN)....................................................................................................................99
MENSAJE DE SOLICITUD.....................................................................................................................................99
MENSAJE DE RESPUESTA..................................................................................................................................100
RECUPERADOR DE VALORES REFERENCIALES DE CÓDIGOS DE TIPOS DE ALÍCUOTAS (FEPARAMGETTIPOSIVA)...................101
DIRECCIÓN URL (HOMOLOGACIÓN)..................................................................................................................101
MENSAJE DE SOLICITUD...................................................................................................................................102
MENSAJE DE RESPUESTA..................................................................................................................................102
RECUPERADOR DE VALORES REFERENCIALES DE CÓDIGOS DE TIPOS DE MONEDAS (FEPARAMGETTIPOSMONEDAS)..........103
DIRECCIÓN URL (HOMOLOGACIÓN)..................................................................................................................104
MENSAJE DE SOLICITUD...................................................................................................................................104
MENSAJE DE RESPUESTA..................................................................................................................................104

---

<!-- page 16 -->

RECUPERADOR DE VALORES REFERENCIALES DE CÓDIGOS DE TIPOS DE DATOS OPCIONALES (FEPARAMGETTIPOSOPCIONAL)
....................................................................................................................................................................106
DIRECCIÓN URL (HOMOLOGACIÓN)..................................................................................................................106
MENSAJE DE SOLICITUD...................................................................................................................................106
MENSAJE DE RESPUESTA..................................................................................................................................106
RECUPERADOR DE VALORES REFERENCIALES DE CÓDIGOS DE TIPOS DE TRIBUTOS (FEPARAMGETTIPOSTRIBUTOS)............108
DIRECCIÓN URL (HOMOLOGACIÓN)..................................................................................................................108
MENSAJE DE SOLICITUD...................................................................................................................................108
MENSAJE DE RESPUESTA..................................................................................................................................109
RECUPERADOR DE LOS PUNTOS DE VENTA ASIGNADOS A FACTURACIÓN ELECTRÓNICA QUE SOPORTEN CAE Y CAEA VÍA WEB
SERVICES (FEPARAMGETPTOSVENTA)................................................................................................................110
DIRECCIÓN URL (HOMOLOGACIÓN)..................................................................................................................110
MENSAJE DE SOLICITUD...................................................................................................................................110
MENSAJE DE RESPUESTA..................................................................................................................................111
RECUPERADOR DE COTIZACIÓN DE MONEDA (FEPARAMGETCOTIZACION).................................................................112
DIRECCIÓN URL (HOMOLOGACIÓN)..................................................................................................................113
MENSAJE DE SOLICITUD...................................................................................................................................113
MENSAJE DE RESPUESTA..................................................................................................................................113
VALIDACIONES Y ERRORES................................................................................................................................115
MÉTODO PARA INFORMAR CAEA SIN MOVIMIENTO (FECAEASINMOVIMIENTOINFORMAR)........................................115
DIRECCIÓN URL (HOMOLOGACIÓN)..................................................................................................................116
MENSAJE DE SOLICITUD...................................................................................................................................116
MENSAJE DE RESPUESTA..................................................................................................................................116
VALIDACIONES Y ERRORES................................................................................................................................118
MÉTODO DUMMY PARA VERIFICACIÓN DE FUNCIONAMIENTO DE INFRAESTRUCTURA (FEDUMMY)................................118
DIRECCIÓN URL (HOMOLOGACIÓN)..................................................................................................................118
MENSAJE DE SOLICITUD...................................................................................................................................119
MENSAJE DE RESPUESTA..................................................................................................................................119
RECUPERADOR DE ULTIMO VALOR DE COMPROBANTE REGISTRADO (FECOMPULTIMOAUTORIZADO)..............................119
RETORNA EL ULTIMO COMPROBANTE AUTORIZADO PARA EL TIPO DE COMPROBANTE / CUIT / PUNTO DE VENTA INGRESADO /
TIPO DE EMISIÓN............................................................................................................................................119
DIRECCIÓN URL (HOMOLOGACIÓN)..................................................................................................................120
MENSAJE DE SOLICITUD...................................................................................................................................120
MENSAJE DE RESPUESTA..................................................................................................................................120
VALIDACIONES, ACCIONES Y ERRORES.................................................................................................................122
RECUPERADOR DE CANTIDAD MÁXIMA DE REGISTROS FECAESOLICITAR / FECAEAREGINFORMATIVO
(FECOMPTOTXREQUEST).................................................................................................................................122
DIRECCIÓN URL (HOMOLOGACIÓN)..................................................................................................................122
MENSAJE DE SOLICITUD...................................................................................................................................122
MENSAJE DE RESPUESTA..................................................................................................................................123
MÉTODO PARA INFORMAR COMPROBANTES EMITIDOS CON CAEA (FECAEAREGINFORMATIVO)..................................124
DIRECCIÓN URL (HOMOLOGACIÓN)..................................................................................................................124
MENSAJE DE SOLICITUD...................................................................................................................................124
MENSAJE DE RESPUESTA..................................................................................................................................131
VALIDACIONES Y ERRORES................................................................................................................................133
OPERATORIA ANTE ERRORES.............................................................................................................................157
OPERATORIA ANTE ERRORES, EJEMPLOS..............................................................................................................158
MÉTODO PARA CONSULTAR CAEA SIN MOVIMIENTO (FECAEASINMOVIMIENTOCONSULTAR)......................................178
DIRECCIÓN URL (HOMOLOGACIÓN)..................................................................................................................178
MENSAJE DE SOLICITUD...................................................................................................................................178
MENSAJE DE RESPUESTA..................................................................................................................................179
VALIDACIONES Y ERRORES................................................................................................................................181
MÉTODO PARA CONSULTAR COMPROBANTES EMITIDOS Y SU CÓDIGO (FECOMPCONSULTAR).......................................181
DIRECCIÓN URL (HOMOLOGACIÓN)..................................................................................................................181

---

<!-- page 17 -->

MENSAJE DE SOLICITUD...................................................................................................................................181
MENSAJE DE RESPUESTA..................................................................................................................................182
VALIDACIONES Y ERRORES................................................................................................................................185
EJEMPLO.......................................................................................................................................................185
MÉTODO PARA CONSULTAR VALORES REFERENCIALES DE CÓDIGOS DE PAÍSES (FEPARAMGETTIPOSPAISES)......................187
DIRECCIÓN URL (HOMOLOGACIÓN)..................................................................................................................187
MENSAJE DE SOLICITUD...................................................................................................................................187
MENSAJE DE RESPUESTA..................................................................................................................................187
MÉTODO PARA CONSULTAR LAS ACTIVIDADES (FEPARAMGETACTIVIDADES)...............................................................188
DIRECCIÓN URL (HOMOLOGACIÓN)..................................................................................................................188
MENSAJE DE SOLICITUD...................................................................................................................................189
MENSAJE DE RESPUESTA..................................................................................................................................189
MÉTODO PARA CONSULTAR VALORES REFERENCIALES DE LOS IDENTIFICADORES DE LA CONDICIÓN FRENTE AL IVA DEL
RECEPTOR (FEPARAMGETCONDICIONIVARECEPTOR).............................................................................................190
DIRECCIÓN URL (HOMOLOGACIÓN)..................................................................................................................190
MENSAJE DE SOLICITUD...................................................................................................................................191
MENSAJE DE RESPUESTA..................................................................................................................................191
VALIDACIONES Y ERRORES................................................................................................................................192
MARGEN DE ERROR MEDIANTE (ERROR ABSOLUTO Y ERROR RELATIVO)...................................................................193
ANEXO..............................................................................................................................................194
CONDICIÓN FRENTE AL IVA DEL RECEPTOR..........................................................................................................195

---

<!-- page 18 -->

Introducción
Este documento está dirigido a quienes tengan que desarrollar el software cliente consumidor
de los WebServices correspondientes al servicio de Facturación Electrónica - RG 4291.

Alcance

Este documento brinda las especificaciones técnicas para desarrollar el cliente de WebServices
para usar el Wsfev1. Debe complementarse con los documentos relativos a: “Servicio de
Autenticación y Autorización y Establecimiento del canal de comunicación” y Resoluciones
Generales involucradas.

Autenticación

Para utilizar cualquiera de los métodos disponibles en el presente WS es necesario un
Ticket de Acceso provisto por el WS de Autenticación y Autorización (WSAA).

Recordar que para consumir el WS de Autenticación y Autorización WSAA es necesa-
rio obtener previamente un certificado digital desde clave fiscal y asociarlo al ws de ne-
gocio "Facturación Electrónica".

Al momento de solicitar un Ticket de Acceso por medio del WS de Autenticación y Au-
torización WSAA tener en cuenta que debe enviar el tag service con el valor "wsfe" y
que la duración del mismo es de 12 hs.


Para más información deberá redirigirse a los manuales www.arca.gob.ar/ws.



Estructura general del mensaje de Respuesta (response)

Los mensajes de respuesta que se transmiten tienen implementado el subelemento
FEHeaderInfo contenido en el elemento opcional Header, que se contempla en la estructura
SOAP. En este webservice se utiliza para brindar información contextual relacionada con el
proceso del mensaje. El procesamiento de dicha información no es obligatoria en los
respectivos clientes, pero contribuye con información contextual de procesamiento que es de
utilidad ante posibles eventualidades.

Ejemplo de mensaje de respuesta en el ambiente de Testing

<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
xmlns:xsd="http://www.w3.org/2001/XMLSchema">

 <soap:Header>

   <FEHeaderInfo xmlns="http://ar.gov.afip.dif.FEV1/">

    <ambiente>Homologacion - Clo</ambiente>

---

<!-- page 19 -->

     <fecha>2018-09-13T12:43:28.2091828-03:00</fecha>

     <id>1.0.2.0</id>

   </FEHeaderInfo>

 </soap:Header>

 <soap:Body>

 </soap:Body>

</soap:Envelope>


Ejemplo de mensaje de respuesta en el ambiente de Producción

<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
xmlns:xsd="http://www.w3.org/2001/XMLSchema">

 <soap:Header>

   <FEHeaderInfo xmlns="http://ar.gov.afip.dif.FEV1/">

     <ambiente>Produccion - Pto</ambiente>

     <fecha>2018-09-13T12:43:28.2091828-03:00</fecha>

     <id>1.0.2.0</id>

   </FEHeaderInfo>

 </soap:Header>

 <soap:Body>

 </soap:Body>

</soap:Envelope>



Tratamiento de errores en el WS

El tratamiento de errores en todos los servicios se realizará de la siguiente manera:


                <Errors>
                      <Err>
                         <Code>int</Code>
                         <Msg>string</Msg>
                      </Err>
                      <Err>
                         <Code>int</Code>
                         <Msg>string</Msg>
                      </Err>
                </Errors>

---

<!-- page 20 -->

Dónde:



       Campo                                     Detalle                                Obligatorio
 Errors               Array de objeto. Err Información correspondiente a errores             N

 Code                 Código de error                                                       S
 Msg                  Mensaje descriptivo del error                                         S


Para errores internos de infraestructura, los errores se devuelven en la misma estructura
(Errors). Los códigos de error son:




  Código de error                                         Causa
 500                  Error interno de aplicación.

 501                  Error interno de base de datos.
                      Error interno de base de datos - Autorizador CAE / Régimen CAEA –
 502
                      Transacción Activa
                      No se corresponden token y firma. Usuario no autorizado a realizar esta
 600
                      operación

 601                  CUIT representada no incluida en token.

 602                  No existen datos en nuestros registros.




Tratamiento de eventos

El tratamiento de eventos en todos los servicios se realizará de la siguiente manera:


                <Events>
                      <Evt>
                         <Code>int</Code>
                         <Msg>string</Msg>
                      </Evt>
                      <Evt>
                         <Code>int</Code>
                         <Msg>string</Msg>
                      </Evt>
                </Events>


Dónde:

---

<!-- page 21 -->

       Campo                                      Detalle                               Obligatorio
                       Array de objeto. Evt Información correspondiente al
Events                                                                                      N
                       mensaje
Code                   Código de evento                                                     S
Msg                    Detalla el evento que se desea comunicar                             S



Dirección URL

       Este servicio se llama en Homologación desde:

         https://wswhomo.afip.gov.ar/wsfev1/service.asmx



       Para visualizar el WSDL en Homologación:

         https://wswhomo.afip.gov.ar/wsfev1/service.asmx?WSDL



       Este servicio se llama en Producción desde:

         https://servicios1.afip.gov.ar/wsfev1/service.asmx



       Para visualizar el WSDL en Producción:

         https://servicios1.afip.gov.ar/wsfev1/service.asmx?WSDL



Canales de Atención

       Consultas sobre el ambiente de homologación:

       - Acerca de certificados y accesos, consultar sitio http://www.arca.gob.ar/ws/
       - Sobre aspectos funcionales del Web Services: wsfev1@arca.gov.ar

       Consultas sobre el ambiente de producción:

       - sri@arca.gov.ar

       Consultas sobre normativa:

       - facturaelectronica@arca.gov.ar




Sitios de Consulta

Biblioteca Electrónica

---

<!-- page 22 -->

ABC – Consultas y Respuestas Frecuentes sobre:

   - Funcionalidades del WS

   - Normativa, Aplicativos y Sistemas. Opción Facturación y Registración

Documentación de Ayuda

   -   http://www.afip.gob.ar/fe/ayuda.asp.

---

<!-- page 23 -->

WS de Negocio
Operaciones

2.4.1   Operaciones a realizar según la RG de aplicación.



- Para “CAE – RG 4291” aplican los siguientes métodos:

           Método de autorización de comprobantes electrónicos por CAE (FECAESolicitar)

1   Para “CAEA – RG 4291” aplican los siguientes métodos:

           Método de obtención de CAEA (FECAEASolicitar)

           Método de consulta de CAEA (FECAEAConsultar)

           Método para informar CAEA sin movimiento (FECAEASinMovimientoInformar)

           Método para informar comprobantes emitidos con CAEA (FECAEARegInformativo)

           Método para consultar CAEA sin movimiento (FECAEASinMovimientoConsultar)

2   Para ambos:

           Recuperador de valores referenciales de códigos de Tipos de comprobante
            (FEParamGetTiposCbte)

           Recuperador de valores referenciales de códigos de Tipos de Conceptos
            (FEParamGetTiposConcepto)

           Recuperador de valores referenciales de códigos de Tipos de Documentos
            (FEParamGetTiposDoc)

           Recuperador de valores referenciales de códigos de Tipos de Alícuotas
            (FEParamGetTiposIva)

           Recuperador de valores referenciales de códigos de Tipos de Monedas
            (FEParamGetTiposMonedas)

           Recuperador de valores referenciales de códigos de Tipos de datos Opcionales
            (FEParamGetTiposOpcional)

            Recuperador de valores referenciales de códigos de Tipos de Tributos
            (FEParamGetTiposTributos)

           Recuperador de los puntos de venta asignados a Facturación Electrónica que
            soporten CAE y CAEA vía Web Services (FEParamGetPtosVenta)

           Recuperador de cotización de moneda (FEParamGetCotizacion)

           Método Dummy para verificación de funcionamiento de infraestructura
            (FEDummy)

           Recuperador de ultimo valor de comprobante registrado
            (FECompUltimoAutorizado)

---

<!-- page 24 -->

              Recuperador de cantidad máxima de registros FECAESolicitar /
               FECAEARegInformativo (FECompTotXRequest)

              Método para consultar Comprobantes Emitidos y su código (FECompConsultar)

              Método para consultar las actividades vigentes del emisor
               (FEParamGetActividades)



   Un contribuyente sólo necesita implementar un cliente para los métodos del WS
   correspondientes a la RG por la cual esté alcanzado. Por ejemplo, si optó por CAEA no es
   necesario que implemente soporte para los métodos FEParamGetPtosVenta.



   Método de autorización de comprobantes electrónicos por CAE (FECAESolicitar)

   El cliente envía la información del comprobante/lote que desea autorizar mediante un
   requerimiento el cual es atendido por WSFEv1 pudiendo producirse las siguientes situaciones:



              Supere todas las validaciones, el comprobante es aprobado, se asigna el CAE y su
               respectiva fecha de vencimiento,

              No supera alguna de las validaciones no excluyentes, el comprobante es aprobado
               con observaciones, se le asigna el CAE con la fecha de vencimiento,

              No supere alguna de las validaciones excluyentes, el comprobante no es aprobado
               y la solicitud es rechazada.



   Cabe aclarar que las validaciones excluyentes son aquellas que en el caso de no ser superadas
   provocan un rechazo y las validaciones no excluyentes aprueban la solicitud pero con
   observaciones.



    Dirección URL (Homologación)
   Este servicio se llama desde:

   https://wswhomo.afip.gov.ar/wsfev1/service.asmx?op= FECAESolicitar



   Mensaje de solicitud
   Recibe la información de un comprobante o lote de comprobantes.


<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
xmlns:ar="http://ar.gov.afip.dif.FEV1/">
   <soapenv:Header/>
   <soapenv:Body>
       <ar:FECAESolicitar>
       <ar:Auth>

---

<!-- page 25 -->

 <ar:Token>string</ar:Token>
   <ar:Sign>string</ar:Sign>
   <ar:Cuit>long</ar:Cuit>
</ar:Auth>
<ar:FeCAEReq>
   <ar:FeCabReq>
      <ar:CantReg>int</ar:CantReg>
      <ar:PtoVta>int</ar:PtoVta>
      <ar:CbteTipo>int</ar:CbteTipo>
   </ar:FeCabReq>
   <ar:FeDetReq>
      <ar:FECAEDetRequest>
         <ar:Concepto>int</ar:Concepto>
         <ar:DocTipo>int</ar:DocTipo>
         <ar:DocNro>long</ar:DocNro>
         <ar:CbteDesde>long</ar:CbteDesde>
         <ar:CbteHasta>long</ar:CbteHasta>
         <ar:CbteFch>string</ar:CbteFch>
         <ar:ImpTotal>double</ar:ImpTotal>
         <ar:ImpTotConc>double</ar:ImpTotConc>
         <ar:ImpNeto>double</ar:ImpNeto>
         <ar:ImpOpEx>double</ar:ImpOpEx>
         <ar:ImpTrib>double</ar:ImpTrib>
         <ar:ImpIVA>double</ar:ImpIVA>
         <ar:FchServDesde>string</ar:FchServDesde>
         <ar:FchServHasta>string</ar:FchServHasta>
         <ar:FchVtoPago>string</ar:FchVtoPago>
         <ar:MonId>string</ar:MonId>
         <ar:MonCotiz>double</ar:MonCotiz>
         <ar:CanMisMonExt>string</ar:CanMisMonExt>
         <ar:CondicionIVAReceptorId>int</ar:CondicionIVAReceptorId>
         <ar:CbtesAsoc>
            <ar:CbteAsoc>
               <ar:Tipo>short</ar:Tipo>
               <ar:PtoVta>int</ar:PtoVta>
               <ar:Nro>Long</ar:Nro>
               <ar:Cuit>String</ar:Cuit>
               <ar:CbteFch>String</ar:CbteFch>
            </ar:CbteAsoc>
         </ar:CbtesAsoc>
         <ar:Tributos>
            <ar:Tributo>
               <ar:Id>short</ar:Id>
               <ar:Desc>string</ar:Desc>
               <ar:BaseImp>double</ar:BaseImp>
               <ar:Alic>double</ar:Alic>
               <ar:Importe>double</ar:Importe>
            </ar:Tributo>
         </ar:Tributos>
         <ar:Iva>
            <ar:AlicIva>
               <ar:Id>short</ar:Id>
               <ar:BaseImp>double</ar:BaseImp>
               <ar:Importe>double</ar:Importe>
            </ar:AlicIva>
         </ar:Iva>
         <ar:Opcionales>
            <ar:Opcional>

---

<!-- page 26 -->

                         <ar:Id>string</ar:Id>
                         <ar:Valor>string</ar:Valor>
                      </ar:Opcional>
                   </ar:Opcionales>
                   <ar:Compradores>
                      <ar:Comprador>
                         <ar:DocTipo>int</ar:DocTipo>
                         <ar:DocNro>Long</ar:DocNro>
                         <ar:Porcentaje>double</ar:Porcentaje>
                      </ar:Comprador>
                   </ar:Compradores>
                   <ar:PeriodoAsoc>
                      <ar:FchDesde>string</ar:FchDesde>
                      <ar:FchHasta>string</ar:FchHasta>
                   </ar:PeriodoAsoc>
                   <ar:Actividades>
                      <ar:Actividad>
                         <ar:Id>Long</ar:Id>
                      </ar:Actividad>
                   </ar:Actividades>
               </ar:FECAEDetRequest>
            </ar:FeDetReq>
         </ar:FeCAEReq>
      </ar:FECAESolicitar>
   </soapenv:Body>
</soapenv:Envelope>


   Dónde:


          Campo                               Detalle                        Obligatorio
                    Información de la autenticación. Contiene los datos de
   Auth                                                                           S
                    Token, Sign y Cuit
   Token            Token devuelto por el WSAA                                    S
   Sign             Sign devuelto por el WSAA                                     S
   Cuit             Cuit contribuyente (representado o Emisora)                   S




          Campo                               Detalle                        Obligatorio
                    Información del comprobante o lote de comprobantes de
   FeCAEReq                                                                       S
                    ingreso. Contiene los datos de FeCabReq y FeDetReq
                    Información de la cabecera del comprobante o lote de
   FeCabReq                                                                       S
                    comprobantes de ingreso
                    Información del detalle del comprobante o lote de
   FeDetReq                                                                       S
                    comprobantes de ingreso



   FeCabReq: La cabecera del comprobante o lote de comprobantes de ingreso está
   compuesta por los siguientes campos:

---

<!-- page 27 -->

      Campo            Tipo                           Detalle                      Obligatorio
                                 Cantidad de registros del detalle del
CantReg              Int (4)                                                            S
                                 comprobante o lote de comprobantes de ingreso
                                 Tipo de comprobante que se está informando. Si
CbteTipo             Int (3)     se informa más de un comprobante, todos deben          S
                                 ser del mismo tipo.
                                 Punto de Venta del comprobante que se está
                                 informando. Si se informa más de un
PtoVta               Int (5)                                                            S
                                 comprobante, todos deben corresponder al
                                 mismo punto de venta.


FeDetReq: El detalle del comprobante o lote de comprobantes de ingreso está compuesto por
los siguientes campos:




Campo               Tipo           Detalle                                         Obligatorio
                                   Concepto del Comprobante. Valores
                                   permitidos:

Concepto            Int(2)         1 Productos                                         S
                                   2 Servicios

                                   3 Productos y Servicios
                                   Código de documento identificatorio del
DocTipo             Int (2)                                                            S
                                   comprador
DocNro              Long (11)      Nro. De identificación del comprador                S
                                   Nro. De comprobante desde
CbteDesde           Long (8)                                                           S
                                   Rango 1- 99999999
                                   Nro. De comprobante registrado hasta
CbteHasta           Long (8)                                                           S
                                   Rango 1- 99999999
                                   Fecha del comprobante (yyyymmdd). Para
                                   concepto igual a 1, la fecha de emisión del
                                   comprobante puede ser hasta 5 días
                                   anteriores o posteriores respecto de la fecha
                                   de generación: La misma no podrá exceder el
CbteFch             String (8)     mes de presentación. Si se indica Concepto          N
                                   igual a 2 ó 3 puede ser hasta 10 días
                                   anteriores o posteriores a la fecha de
                                   generación. Si no se envía la fecha del
                                   comprobante se asignará la fecha de proceso.

                                   Para comprobantes del tipo MiPyMEs (FCE)

---

<!-- page 28 -->

Campo        Tipo     Detalle                                          Obligatorio
                      del tipo Factura, la fecha de emisión del
                      comprobante debe ser desde 5 días
                      anteriores y hasta 1 día posterior respecto de
                      la fecha de generación. Para notas de débito y
                      crédito es hasta 5 dias anteriores y tiene que
                      ser posterior o igual a la fecha del
                      comprobante asociado.

                      Importe total del comprobante, Debe ser
             Double   igual a Importe neto no gravado + Importe
ImpTotal                                                                   S
             (13+2)   exento + Importe neto gravado + todos los
                      campos de IVA al XX% + Importe de tributos.

                      Importe neto no gravado.

                      Debe ser menor o igual a Importe total y no
                      puede ser menor a cero.

                      No puede ser mayor al Importe total de la
             Double   operación ni menor a cero (0).
ImpTotConc                                                                 S
             (13+2)
                      Para comprobantes tipo C debe ser igual a
                      cero (0).

                      Para comprobantes tipo Bienes Usados –
                      Emisor Monotributista este campo
                      corresponde al importe subtotal.
                      Importe neto gravado. Debe ser menor o
                      igual a Importe total y no puede ser menor a
                      cero. Para comprobantes tipo C este campo
             Double   corresponde al Importe del Sub Total.
ImpNeto                                                                    S
             (13+2)
                      Para comprobantes tipo Bienes Usados –
                      Emisor Monotributista no debe informarse o
                      debe ser igual a cero (0).
                      Importe exento. Debe ser menor o igual a
                      Importe total y no puede ser menor a cero.

                      Para comprobantes tipo C debe ser igual a
             Double
ImpOpEx               cero (0).                                            S
             (13+2)
                      Para comprobantes tipo Bienes Usados –
                      Emisor Monotributista no debe informarse o
                      debe ser igual a cero (0).
                      Suma de los importes del array de IVA.

             Double   Para comprobantes tipo C debe ser igual a
ImpIVA                cero (0).                                            S
             (13+2)
                      Para comprobantes tipo Bienes Usados –
                      Emisor Monotributista no debe informarse o

---

<!-- page 29 -->

Campo              Tipo         Detalle                                            Obligatorio
                                debe ser igual a cero (0).
                   Double
ImpTrib                         Suma de los importes del array de tributos             S
                   (13+2)
                                Fecha de inicio del abono para el servicio a
                                facturar. Dato obligatorio para concepto 2 o
FchServDesde       String (8)                                                          N
                                3 (Servicios / Productos y Servicios). Formato
                                yyyymmdd
                                Fecha de fin del abono para el servicio a
                                facturar. Dato obligatorio para concepto 2 o
FchServHasta       String (8)   3 (Servicios / Productos y Servicios). Formato         N
                                yyyymmdd. FchServHasta no puede ser menor
                                a FchServDesde
                                Fecha de vencimiento del pago servicio a
                                facturar. Dato obligatorio para concepto 2 o
                                3 (Servicios / Productos y Servicios) o Facturas
FchVtoPago         String (8)                                                          N
                                del tipo MiPyMEs (FCE). Formato yyyymmdd.
                                Debe ser igual o posterior a la fecha del
                                comprobante.


                                Código de moneda del comprobante.
MonId              String (3)   Consultar método FEParamGetTiposMonedas                S
                                para valores posibles


                                Cotización de la moneda informada. Para PES,
                   Double       pesos argentinos la misma debe ser 1. De
MonCotiz                                                                               N
                   (4+6)        informar el campo, el mismo no puede quedar
                                vacío.
                                Marca que identifica si el comprobante se
CanMisMonExt       String (1)   cancela en misma moneda del comprobante                N
                                (moneda extranjera). Valores posibles S o N.
                                Condición Frente al IVA del receptor.
                                Consultar método
                                “FEParamGetCondicionIvaReceptor”

CondicionIVARece                Campo Condición Frente al IVA del receptor
                   Int (2)      resultará obligatorio conforme lo                      N
ptorId
                                reglamentado por la Resolución General N°
                                5616. Si el valor informado no es valido, para
                                CAE rechazará y en CAEA observará. Si el valor
                                no existe rechazará en ambos casos.

                                Array para informar los comprobantes
CbtesAsoc          Array                                                               N
                                asociados <CbteAsoc>

Tributos           Array        Array para informar los tributos asociados a           N

---

<!-- page 30 -->

Campo              Tipo         Detalle                                         Obligatorio



                                un comprobante <Tributo>.



                                Array para informar las alícuotas y sus
                                importes asociados a un comprobante
                                <AlicIva>.
IVA                Array                                                             N
                                Para comprobantes tipo C y Bienes Usados –
                                Emisor Monotributista no debe informar el
                                array.
                                Array de campos auxiliares. Reservado usos
Opcionales         Array                                                             N
                                futuros <Opcional>. Adicionales por R.G.
                                Array para informar los múltiples
Compradores        Comprador                                                         N
                                compradores.
                                Estructura compuesta por la fecha desde y la
PeriodoAsoc        Periodo      fecha hasta del periodo que se quiere                N
                                identificar
                                Array para informar las actividades asociadas
Actividades        Actividad                                                         N
                                a un comprobante.


CbtesAsoc: Detalle de los comprobantes relacionados con el comprobante que se so-
licita autorizar (array).

      Campo          Tipo                          Detalle                      Obligatorio

                                 Código de tipo de comprobante. Consul-
 Tipo          Int (3)                                                              S
                                 tar método FEParamGetTiposCbte.

                                 Punto de venta del comprobante asocia-
 PtoVta        Int (5)                                                              S
                                 do

 Nro           Long (8)          Numero de comprobante asociado                     S

 Cuit          String(11)        Cuit emisor del comprobante asociado               N

 CbteFch       String(8)         Fecha del comprobante asociado                     N

Tributos: Detalle de tributos relacionados con el comprobante que se solicita autori-
zar (array).
     Campo           Tipo                         Detalle                    Obligatorio
                                Código tributo según método
 Id            Int (2)                                                               S
                                FEParamGetTiposTributos
 Desc          String (80)      Descripción del tributo.                             N

---

<!-- page 31 -->

                                      Base imponible para la determinación del
 BaseImp         Double (13+2)                                                              S
                                      tributo
 Alic            Double (3+2)         Alícuota                                              S
 Importe         Double (13+2)        Importe del tributo                                   S


IVA: Detalle de alícuotas relacionadas con el comprobante que se solicita autorizar
(array).
    Campo            Tipo                       Detalle                    Obligatorio
Id              Int (2)              Código de tipo de iva. Consultar método                S
                                     FEParamGetTiposIva
BaseImp         Double (13+2)        Base imponible para la determinación de la             S
                                     alícuota.
Importe         Double (13+2)        Importe                                                S


Opcionales: Campos auxiliares (array). Adicionales por R.G.

Los datos opcionales sólo deberán ser incluidos si el emisor pertenece al conjunto de emisores
habilitados a informar opcionales. En ese caso podrá incluir el o los datos opcionales que
correspondan, especificando el identificador de dato opcional de acuerdo a la situación del
emisor. El listado de tipos de datos opcionales se puede consultar con el método
FEParamGetTiposOpcional.

Ejemplo: si el emisor está incluido en el “Régimen de Promoción Industrial”, deberá incluir un
array de opcionales con un registro como el sig.

        <ar:Opcionales>

                <ar:Opcional>

                          <ar:Id>2</ar:Id>

                          <ar:Valor>12345678</ar:Valor>

               </ar:Opcional>

        </ar:Opcionales>

Si el comprobante que intenta autorizar corresponde a Establecimientos de educación pública
de gestión privada según Resolución General N° 3.368 deberá incluir un array de opcionales
con registros como el siguiente ejemplo:

        <ar:Opcionales>

                <ar:Opcional>

                          <ar:Id>10</ar:Id>

                          <ar:Valor>1</ar:Valor>

               </ar:Opcional>

                <ar:Opcional>

---

<!-- page 32 -->

               <ar:Id>1011</ar:Id>

               <ar:Valor>80</ar:Valor>

       </ar:Opcional>

       <ar:Opcional>

               <ar:Id>1012</ar:Id>

               <ar:Valor>30000000007</ar:Valor>

       </ar:Opcional>

</ar:Opcionales>



Si el comprobante que intenta autorizar corresponde a Operaciones económicas
vinculadas con bienes inmuebles según RG N° 2.820 deberá incluir un array de
opcionales con un registro como el siguiente ejemplo:



<ar:Opcionales>

       <ar:Opcional>

               <ar:Id>11</ar:Id>

               <ar:Valor>1</ar:Valor>

       </ar:Opcional>

</ar:Opcionales>



Si el comprobante que intenta autorizar corresponde a Locación temporaria de
inmuebles con fines turísticos según RG N° 3.687 deberá incluir un array de opcionales
con un registro como el siguiente ejemplo:



<ar:Opcionales>

       <ar:Opcional>

               <ar:Id>12</ar:Id>

               <ar:Valor>1</ar:Valor>

       </ar:Opcional>

</ar:Opcionales>



Si el comprobante que intenta autorizar corresponde a Representantes de Modelos
según RG N° 2.863 deberá incluir un array de opcionales con un registro como el
siguiente ejemplo:

---

<!-- page 33 -->

<ar:Opcionales>

       <ar:Opcional>

               <ar:Id>13</ar:Id>

               <ar:Valor>1</ar:Valor>

       </ar:Opcional>

</ar:Opcionales>



Si el comprobante que intenta autorizar corresponde a Agencias de publicidad según
RG N° 2.863 deberá incluir un array de opcionales con un registro como el siguiente
ejemplo:



<ar:Opcionales>

       <ar:Opcional>

               <ar:Id>14</ar:Id>

               <ar:Valor>1</ar:Valor>

       </ar:Opcional>

</ar:Opcionales>




Si el comprobante que intenta autorizar corresponde a Personas físicas que
desarrollen actividad de modelaje según RG N° 2.863 deberá incluir un array de
opcionales con un registro como el siguiente ejemplo:



<ar:Opcionales>

       <ar:Opcional>

               <ar:Id>15</ar:Id>

               <ar:Valor>1</ar:Valor>

       </ar:Opcional>

</ar:Opcionales>



Si el comprobante que intenta autorizar es del tipo B o C con locación de inmuebles
destino "casa-habitación" facturación directa según RG N° 4004-E deberá incluir un
array de opcionales con un registro como el siguiente ejemplo:

---

<!-- page 34 -->

<ar:Opcionales>

       <ar:Opcional>

               <ar:Id>17</ar:Id>

               <ar:Valor>2</ar:Valor>

       </ar:Opcional>

</ar:Opcionales>



Si el comprobante que intenta autorizar es del tipo B o C con locación de inmuebles
destino "casa-habitación" facturación a través de intermediario según RG N° 4004-E
deberá incluir un array de opcionales con un registro como el siguiente ejemplo:

<ar:Opcionales>

       <ar:Opcional>

               <ar:Id>17</ar:Id>

               <ar:Valor>1</ar:Valor>

       </ar:Opcional>

</ar:Opcionales>



Si el comprobante que intenta autorizar es del tipo B o C con locación de inmuebles
destino "casa-habitación" con facturación directa con cotitulares o indirecta con los
datos de el/los titular/es según RG N° 4004-E deberá incluir opcionales con al menos 2
registros como el siguiente ejemplo:

<ar:Opcionales>

       <ar:Opcional>

               <ar:Id>1801</ar:Id>

               <ar:Valor>30000000007</ar:Valor>

       </ar:Opcional>

       <ar:Opcional>

               <ar:Id>1802</ar:Id>

               <ar:Valor>DENOMINACION EJEMPLO</ar:Valor>

       </ar:Opcional>

</ar:Opcionales>

---

<!-- page 35 -->

       Campo               Tipo                         Detalle                     Obligatorio
Id                 String(4)       Código de Opcional, consultar método
                                                                                               S
                                   FEParamGetTiposOpcional
Valor              String (250)    Valor                                                       S



Comprador: Detalle compradores vinculados al comprobante que se solicita autorizar
(array).
     Campo         Tipo                        Detalle                    Obligatorio
 DocTipo        Int (2)            Tipo de documento del comprador                         S
 DocNro         String (80)        Número de documento del comprador                       S
                                   Porcentaje de titularidad que tiene el
 Porcentaje     Double (2+2)                                                               S
                                   comprador


Periodo: Estructura que permite soportar un rango de fechas.

      Campo            Tipo                           Detalle                    Obligatorio

                                   Fecha correspondiente al inicio del perio-
 FchDesde       String(8)          do de los comprobantes que se quiere                S
                                   identiricar

                                   Fecha correspondiente al fin del periodo
 FchHasta       String(8)          de los comprobantes que se quiere iden-             S
                                   tificar


Actividad: Detalle de la actividad relacionada con las actividades (array) que se indi-
can en el comprobante a autorizar.
    Campo            Tipo                          Detalle                     Obligatorio
                                   Código actividad según método
 Id             Long (6)                                                                   S
                                   FEParamGetActividades




Mensaje de respuesta
Retorna la información del comprobante o lote de comprobantes de ingreso agregándole el
CAE otorgado si el comprobante fue aprobado. Ante cualquier anomalía se retorna un array
con errores detectados (Errors) o un array de observaciones según corresponda.



  <soap:Envelope xmlns:soap=”http://www.w3.org/2003/05/soap-envelope”
  xmlns:ar=”http://ar.gov.afip.dif.fev1/”>
     <soap:Header/>
     <soap:Body>

---

<!-- page 36 -->

        <FECAESolicitarResponse>
           <FECAESolicitarResult>
              <FeCabResp>
                  <Cuit>long</Cuit>
                  <PtoVta>int</PtoVta>
                  <CbteTipo>int</CbteTipo>
                  <FchProceso>string</FchProceso>
                  <CantReg>int</CantReg>
                  <Resultado>string</Resultado>
                  <Reproceso>string</Reproceso >
              </FeCabResp>
              <FeDetResp>
                  <FEDetResponse>
                     <Concepto>int</Concepto>
                     <DocTipo>int</DocTipo>
                     <DocNro>long</DocNro>
                     <CbteDesde>long</CbteDesde>
                     <CbteHasta>long</CbteHasta>
                     <Resultado>string</Resultado>
                     <CAE>string</CAE>
                     <CbteFch>string</CbteFch>
                     <CAEFchVto>string</CAEFchVto>
                     <Obs>
                         <Observaciones>
                            <Code>int</Code>
                            <Msg>string</Msg>
                         </Observaciones>
                     </Obs>
                  </FEDetResponse>
              </FeDetResp>
              <Events>
                  <Evt>
                     <Code>int</Code>
                     <Msg>string</Msg>
                  </Evt>
              </Events>
              <Errors>
                  <Err>
                     <Code>int</Code>
                     <Msg>string</Msg>
                  </Err>
              </Errors>
           </FECAESolicitarResult>
        </FECAESolicitarResponse>
     </soap:Body>
  </soap:Envelope>


Dónde:

         Campo                                 Detalle                            Obligatorio
                       Información del comprobante o lote de comprobantes de
FECAESolicitarResult   ingreso, conteniendo el CAE otorgado. Contiene los datos       S
                       de FeCabResp y FeDetResp, Errors y Events
                       Información de la cabecera del comprobante o lote de
FeCabResp                                                                             S
                       comprobantes de ingreso

---

<!-- page 37 -->

                             Información del detalle del comprobante o lote de
FeDetResp                                                                                  S
                             comprobantes de ingreso conteniendo el CAE otorgado
Errors                       Información de errores detectados                             N
Events                       Información de eventos                                        N


FeCabResp: La cabecera del comprobante o lote de comprobantes de ingreso estará
compuesta por los siguientes campos:

   Campo             Tipo                               Detalle                       Obligatorio
Cuit            Long (11)         Cuit del contribuyente                                   S
PtoVta          Int (5)           Punto de venta                                           S
CbteTipo        Int (3)           Tipo de comprobante                                      S
FchProceso      String (14)       Fecha de proceso formato yyyymmddhhmiss                  S
                                  Cantidad de registros del detalle del comprobante
CantReg         Int (4)                                                                    S
                                  o lote de comprobantes de ingreso
Resultado       String (1)        Resultado                                                S
Reproceso       String            Campo no operativo para esta versión.                    N


FeDetResp: El detalle del comprobante o lote de comprobantes de ingreso estará compuesta
por los siguientes campos:



   Campo             Tipo                               Detalle                       Obligatorio
Concepto        Int (2)           Concepto                                                 S
DocTipo         Int (2)           Código de documento identificador del comprador          S
DocNro          Long (11)         Nro. De identificación del comprador                     S
CbteDesde       Long (8)          Nro. De comprobante desde                                S
CbteHasta       Long (8)          Nro. De comprobante registrado hasta                     S
CbteFch         String (8)        Fecha del comprobante                                    N
Resultado       String (1)        Resultado                                                S
CAE             String (14)       Código de autorización electrónico                       N
                                  Fecha de vencimiento o vencimiento de la
CAEFchVto       String (8)                                                                 N
                                  autorización
Observaciones Array               Detalle de observaciones, del comprobante                N

---

<!-- page 38 -->

Observaciones: La estructura de datos Obs muestra el detalle de observaciones para
un comprobante determinado; estará compuesta por los siguientes campos:
    Campo         Tipo                         Detalle                       Obligatorio
Code             Int (5)         Código de observación                                         S
Msg              String (255)    Mensaje                                                       S


Validaciones y errores

Controles aplicados al objeto <Auth>
Validaciones Excluyentes

    Campo /          Código de
                                                          Descripción de la validación
     Grupo             error
                                  Verificación de datos registrales, Inscripción en el régimen, autorización de
                                  emisión de comprobantes, domicilio fiscal. Etc.

                                  Los mensajes posibles son

                                  01     “LA CUIT INFORMADA NO CORRESPONDE A UN RESPONSABLE
                                  INSCRIPTO EN EL IMPUESTO”

                                  02    “LA CUIT INFORMADA NO SE ENCUENTRA AUTORIZADA A EMITIR
                                  COMPROBANTES ELECTRONICOS ORIGINALES O EL PERIODO DE INICIO
                                  AUTORIZADO ES POSTERIOR AL DE LA GENERACION DE LA SOLICITUD”

                                  03    “LA CUIT INFORMADA REGISTRA INCONVENIENTES CON EL
                                  DOMICILIO FISCAL”

                                  04      “LA CUIT INFORMADA NO SE ENCUENTRA AUTORIZADA A EMITIR
                                  COMPROBANTES CLASE “A” O FACTURA DE CREDITO, (Esta validación no
                                  aplica para comprobantes tipo C)”
      <Cuit>             10000    05   “EL CUIT INFORMADO COMO EMISOR NO SE ENCUENTRA
                                  REGISTRADO DE FORMA ACTIVA EN LAS BASES DE LA ADMINISTRACIÓN.”

                                  06      “DEBE POSEER AL MENOS UNA ACTIVAD ACTIVA.” (Esta validación
                                  no aplica para comprobantes tipo C”

                                  07 “NO AUTORIZADO A EMITIR COMPROBANTES – LA CUIT INFORMADA
                                  NO SE ENCUENTRA AUTORIZADA A EMITIR COMPROBANTES SEGÚN RG
                                  3411” (Esta validación solo aplica para comprobante 49 – Bien Usado”)

                                  08 “NO AUTORIZADO A EMITIR COMPROBANTES – LA CUIT INFORMADA
                                  NO CORRESPONDE A UN EXENTO EN IVA.

                                  09 “LA CUIT INFORMADA NO SE ENCUENTRA AUTORIZADA A EMITIR
                                  COMPROBANTES CLASE A CON LEYENDA ‘OPERACIÓN SUJETA A
                                  RETENCIÓN’”

                                  10 “LA CUIT INFORMADA NO SE ENCUENTRA REGISTRADA COMO PYME
                                  SEGÚN EL REGIMEN FCE”

---

<!-- page 39 -->

                               11 “LA CUIT INFORMADA NO TIENE ACTIVO EL DOMICILIO FISCAL
                               ELECTRONICO”



Controles aplicados al objeto <FeCabReq>


Validaciones Excluyentes

    Campo /        Código de
                                                       Descripción de la validación
     Grupo           error
                               Cantidad de registros de detalle del comprobante o lote de comprobantes
 <CantReg>           10001
                               de ingreso <CantReg> debe estar comprendido entre 1 y 9998.
                               La cantidad de registros del detalle del comprobante o lote de
 <CantReg>           10002     comprobantes de ingreso debe ser igual a lo informado en cabecera del
                               comprobante o lote de comprobantes de ingreso <CantReg>
                               La cantidad de registros en detalle debe ser menor igual al valor permitido.
 Cantidad de
                               Consulte método FECompTotXRequest para obtener cantidad máxima de
 registros           10003
                               registros por cada requerimiento. Para comprobantes del tipo MiPyMEs
 incluidos
                               (FCE), la cantidad habilitada es 1 comprobante por request
 <PtoVta>            10004     Campo <PtoVta> debe estar comprendido entre 1 y 99998.
 <PtoVta>            10005     El punto de venta informado debe estar dado de alta y ser del tipo RECE.
 <CbteTipo>          10006     Campo CbteTipo debe ser un valor numérico mayor a 0.
                               Campo CbteTipo sea:

                               - 01, 02, 03, 04, 05 ,34, 39, 60, 63, 201, 202, 203 para los clase A

                               - 06, 07, 08, 09, 10, 35, 40,64, 61, 206, 207, 208 para los clase B.

                               - 11, 12, 13, 15, 211, 212, 213 para los clase C.
 <CbteTipo>          10007
                               - 51, 52, 53, 54 para los clase “A con leyenda operación sujeta a
                               retención”.

                               - 49 para los Bienes Usados.

                               Consultar método FEParamGetTiposCbte.


Controles aplicados al objeto <FeDetReq>
Validaciones Excluyentes



                                                           Código
                     Campo / Grupo                                          Descripción de la validación
                                                           de error
                                                                       Campo <CbteDesde> se encuentre
 <CbteDesde>                                                  10008
                                                                       entre 1 y 99999999.
 <CbteHasta>                                                  10010    Campo <CbteHasta> se encuentre

---

<!-- page 40 -->

                                         Código
                  Campo / Grupo                         Descripción de la validación
                                         de error
                                                    entre 1 y 99999999.
                                                    Campo <CbteHasta> sea mayor o
                                                    igual a <CbteDesde> para
<CbteHasta>                               10011     comprobantes tipo B. Para
                                                    comprobantes tipo C <CbteHasta>
                                                    debe ser igual a <CbteDesde>.
                                                    Para comprobantes clase “A”, “C”,
                                                    “A con leyenda operación sujeta a
                                                    retención”, “49” – Bienes Usados y
<CbteTipo> / <CbteDesde> / <CbteHasta>    10012
                                                    comprobantes MiPyMEs (FCE) el
                                                    campo CbteDesde debe ser igual al
                                                    campo CbteHasta
                                                    Para comprobantes clase “A” y “A
                                                    con leyenda operación sujeta a
<CbteTipo> / <DocTipo>                    10013
                                                    retención” el campo DocTipo tenga
                                                    valor 80 (CUIT)
                                                    Para comprobantes clase B y
                                                    CbteHasta distinto a CbteDesde el
<CbteTipo> / <CbteDesde> / <CbteHasta>    10014     resultado de la operación ImpTotal /
                                                    (CbteHasta –CbteDesde +1) < monto
                                                    en pesos resultante según RG4444.
                                                    Para comprobantes tipo B en
                                                    pedidos múltiples (CbteDesde
                                                    distinto a CbteHasta) y el resultado
                                                    de la operación ImpTotal /
                                                    (CbteHasta – CbteDesde + 1 ) <
                                                    monto en pesos resultante según
                                                    RG4444. el campo DocTipo deberá
                                                    ser igual a 99, el campo DocNro
                                                    deberá ser cero (0).

                                                    Para comprobantes tipo B en
<CbteTipo> / <DocTipo> / <DocNro>         10015     pedidos individuales (CbteDesde
                                                    igual a CbteHasta) y el resultado de
                                                    la operación ImpTotal / (CbteHasta –
                                                    CbteDesde + 1 ) < monto en pesos
                                                    resultante según RG4444 si el campo
                                                    DocTipo es igual a 99, el campo
                                                    DocNro deberá ser cero.

                                                    Para comprobantes tipo B
                                                    individuales (CbteDesde igual a
                                                    CbteHasta), si el campo DocTipo es
                                                    80, 86 u 87, deberá verificarse que el
                                                    número consignado se encuentre en

---

<!-- page 41 -->

                                  Código
                  Campo / Grupo                  Descripción de la validación
                                  de error
                                             los padrones de ARCA. Si DocTipo es
                                             80 y DocNro es 23000000000 (No
                                             Categorizado) esta validación no se
                                             tendrá en cuenta.

                                             Si el campo DocTipo es distinto de
                                             80, 86 u 87, deberá verificarse que
                                             se ingrese uno de los valores
                                             devueltos por el método
                                             FEParamGetTiposDoc y que se
                                             informe el campo DocNro.

                                             Para pedidos individuales
                                             (CbteDesde igual a CbteHasta) tipo B
                                             con montos superiores a monto en
                                             pesos resultante según RG4444 el
                                             campo DocTipo deberá ser igual a
                                             algunos de los valores devueltos por
                                             el método FEParamGetTiposDoc
                                             excepto 99 y deberá informar el
                                             campo DocNro.

                                             Para comprobantes tipo 49 – Bienes
                                             Usados, DocTipo deberá ser igual a
                                             algunos de los valores devueltos por
                                             el método FEParamGetTiposDoc
                                             excepto el 99 y deberá informar el
                                             campo DocNro.

                                             Para comprobantes tipo 49 – Bienes
                                             Usados, si DocTipo es 80, 86 u 87,
                                             deberá verificarse que el número
                                             consignado se encuentra en los
                                             padrones de arca.

                                             Para comprobantes MiPyMEs (FCE)
                                             el documento del receptor debe ser
                                             80 CUIT.
                                             El número de comprobante
                                             informado <CbteDesde> debe ser
                                             mayor en 1 al último informado para
                                             igual punto de venta y tipo de
                                             comprobante. Consultar método
<CbteDesde> / <CbteFch>            10016     FECompUltimoAutorizado



                                             El campo <CbteFch> podrá ser:

                                             - Nulo o comprendido en el rango

---

<!-- page 42 -->

                                     Código
                     Campo / Grupo                  Descripción de la validación
                                     de error
                                                N-5 y N+5 siendo N la fecha de
                                                envío del pedido de autorización,
                                                para Concepto= 01 Productos. La
                                                misma no podrá exceder el mes de
                                                presentación.

                                                - Para Concepto 02, 03 el campo
                                                CbteFch puede ser nulo o
                                                comprendido en el rango N-10 y
                                                N+10 siendo N la fecha de envío del
                                                pedido de autorización.

                                                - Deberá ser mayor o igual al del
                                                ultimo comprobante emitido para
                                                ese tipo y punto de venta

                                                - Para comprobantes MiPyMEs (FCE)
                                                estar comprendido en el rango N-5
                                                y N+1 siendo N la fecha de envío del
                                                pedido de autorización. De tratarse
                                                de notas de débito o crédito, la
                                                fecha del comprobante puede ser
                                                hasta N-5.
                                                Si <ImpIVA> es igual a 0 los objetos
                                                <IVA> y <AlicIva> solo deben
                                                informarse con ImpIVA = 3 (iva 0)

                                                Si <ImpIVA> es mayor a 0 el objeto
<AlicIVA>                             10018     <IVA> y <AlicIva> son obligatorios.

                                                El objeto <AlicIva> es obligatorio y
                                                no debe ser nulo si ingresa <IVA>

                                                No aplica para comprobantes tipo C.
                                                El campo Id en AlicIVA es obligatorio
                                                informarlo.

                                                Si el tipo de comprobante es 2, 3, 7,
                                                8, 52 o 53 informarlo es opcional.
<AlicIVA><id>                         10019
                                                Siempre que se informe Id, debe ser
                                                un valor devuelto por el método
                                                FEParamGetTiposIva.

                                                No aplica para comprobantes tipo C.
                                                El campo BaseImp en AlicIVA es
<AlicIVA><BaseImp>                    10020     obligatorio y debe ser mayor a 0
                                                cero. Excepto para comprobantes 2,
                                                3, 7, 8, 52 o 53 que puede ser cero o

---

<!-- page 43 -->

                                     Código
                     Campo / Grupo                  Descripción de la validación
                                     de error
                                                no ser informado.

                                                No aplica para comprobantes tipo C.
                                                El campo Importe en AlicIVA es
                                                obligatorio, mayor o igual 0 cero.
                                                Excepto para comprobantes 2, 3, 7,
<AlicIVA><Importe>                    10021     8, 52 o 53 que puede ser cero o no
                                                ser informado.

                                                No aplica para comprobantes tipo C.
                                                El campo Id en AlicIVA no debe
                                                repetirse. Deberá totalizarse por
<AlicIVA><id>                         10022     alícuota.

                                                No aplica para comprobantes tipo C.
                                                La suma de los campos <importe> en
                                                <IVA> debe ser igual al valor
                                                ingresado en ImpIVA.

                                                Margen de error:
<ImpIVA> /
                                      10023     Error relativo porcentual deberá ser
<AlicIVA><importe>
                                                <= 0.01% o el error absoluto <=0.01
                                                * cantidad de alícuotas de IVA
                                                ingresadas *

                                                No aplica para comprobantes tipo C.
                                                Si ImpTrib es mayor a 0 el objeto
                                                <Tributos> y <Tributo> son
                                                obligatorios.

                                                El objeto <Tributo> es obligatorio y
<Tributo>                             10024     no deber ser nulo si se incluye el
                                                objeto <Tributos>

                                                Si impTrib es igual a cero el objeto
                                                <Tributos> y <Tributo> no deben
                                                enviarse.
                                                El campo <Id> en <Tributo> es
                                                obligatorio y debe ser alguno de los
<Tributo><id>                         10025
                                                devueltos por el método
                                                FEParamGetTiposTributos
                                                El campo <BaseImp> en <Tributo>
<Tributo><BaseImp>                    10026     es obligatorio y debe ser mayor o
                                                igual a 0 cero
<Tributo><Alic>                       10027     El campo <Alic> en <Tributo> es

---

<!-- page 44 -->

                                                 Código
                     Campo / Grupo                              Descripción de la validación
                                                 de error
                                                            obligatorio , mayor o igual 0 cero
                                                            El campo <Importe> en <Tributo>
<Tributo><importe>                                10028
                                                            es obligatorio , mayor o igual 0 cero
                                                            La suma de los importes en
                                                            <Tributo> debe ser igual al valor
                                                            ingresado en <ImpTrib>
<ImpTrib> /
                                                  10029     Margen de error:
<Tributo><importe>
                                                            Error relativo porcentual deberá ser
                                                            <= 0.01% o el error absoluto <=0.01
                                                            * cantidad de tributos *
                                                            El campo <Concepto> es obligatorio
                                                            y debe corresponder con algún
                                                            valor devuelto por el método
                                                            FEParamGetTiposConcepto

<concepto>                                        10030     1 Productos

                                                            2 Servicios

                                                            3 Productos y Servicios


                                                            El campo “fecha desde del servicio a
                                                            facturar” <FchServDesde> es
                                                            obligatorio si se informa “fecha
<FchServDesde> / <FchServHasta> / <FchVtoPago>    10031     hasta del servicio a facturar”
                                                            <FchServHasta> y/o “fecha de
                                                            vencimiento para el pago”
                                                            <FchVtoPago>.
                                                            El campo “fecha desde del servicio a
                                                            facturar” <FchServDesde> no
<FchServDesde> / <FchServHasta>                   10032     puede ser posterior al campo “fecha
                                                            hasta del servicio a facturar”
                                                            <FchServHasta>.
                                                            El campo “fecha hasta del servicio a
                                                            facturar” <FchServHasta> es
                                                            obligatorio si se informa “fecha
<FchServDesde> / <FchServHasta> / <FchVtoPago>    10033     desde del servicio a facturar”
                                                            <FchServDesde> y/o “fecha de
                                                            vencimiento para el pago”
                                                            <FchVtoPago>.
                                                            El campo “fecha de vencimiento
<FchServDesde> / <FchServHasta> / <FchVtoPago>    10035     para el pago” <FchVtoPago> es
                                                            obligatorio si se informa “fecha

---

<!-- page 45 -->

                                 Código
                 Campo / Grupo                  Descripción de la validación
                                 de error
                                            desde del servicio a facturar”
                                            <FchServDesde> y/o “fecha hasta
                                            del servicio a facturar”
                                            <FchServHasta>.
                                            El campo “fecha de vencimiento
                                            para el pago” <FchVtoPago> no
<FchVtoPago>                      10036
                                            puede ser anterior a la fecha del
                                            comprobante.
                                            El campo <MonId> es obligatorio y
                                            debe corresponder a algún valor
<MonId>                           10037
                                            devuelto por el método
                                            FEParamGetTiposMonedas
                                            El campo <MonCotiz> es obligatorio
                                            si    no    informa      el    campo
                                            CanMisMonExt = S, y de informarse
                                            debe ser mayor a 0. Si se indica que
                                            el pago del comprobante se realiza
                                            en la misma moneda extranjera que
                                            la factura, la cotización de la
                                            moneda provista debe coincidir
                                            exactamente con la registrada en las
<MonCotiz>                        10038
                                            bases de ARCA para el día hábil
                                            anterior a la fecha de emisión del
                                            comprobante, si esta es anterior a la
                                            fecha actual, o bien con la registrada
                                            para el día hábil anterior a la fecha
                                            actual, si la fecha de emisión es
                                            posterior a esta. En caso contrario,
                                            se puede omitir el campo de
                                            Cotización de Moneda.
                                            El campo <MonCotiz> es obligatorio
<MonId> / <MonCotiz>              10039     , e igual a 1 cuando se trate de
                                            <MonId>=PES
                                            De enviarse el tag <CbtesAsoc>,
                                            entonces el campo “código de tipo
                                            de comprobante” <CbteTipo> a
                                            autorizar tiene que ser 01, 02, 03,
<CbtesAsoc> /                               06, 07, 08, 12, 13, 51, 52, 53, 201,
                                  10040     206 o 211
<CbteTipo>
                                            Para 02 y 03 pueden asociarse los
                                            tipos de comprobante 01, 02, 03,
                                            04, 05, 34, 39, 60, 63, 88 y 991

                                            Para 07 y 08 pueden asociarse 06,

---

<!-- page 46 -->

                                   Código
                   Campo / Grupo                  Descripción de la validación
                                   de error
                                              07, 08, 09, 10, 35, 40, 61, 64, 88 y
                                              991

                                              Para 12 o 13 pueden asociarse 11,
                                              12, 13 y 15.

                                              Para 52 o 53 pueden asociarse 51,
                                              52, 53, 54, 88 y 991

                                              Para 01,06 y 51 pueden asociarse 88
                                              y 991

                                              Para comprobantes MiPyMEs (FCE)
                                              201, 206 o 211 puede asociarse los
                                              comprobantes (91, 990, 991, 993,
                                              994, 995).

                                              Para comprobantes MiPyMEs (FCE)
                                              A 202 y 203, puede asociar 201,202
                                              o 203.

                                              Para comprobantes MiPyMEs (FCE) B
                                              207, 208 puede asociar 206, 207,
                                              208.

                                              Para comprobantes MiPyMEs (FCE) C
                                              212, 213 puede asociarse 211, 212,
                                              213.
                                              El campo <Desc> en Tributo es
                                              obligatorio cuando se informe <Id>
<Tirbuto><Id> / <Tirbuto><Desc>     10042     = 99.

                                              Para comprobantes MiPyMEs (FCE)
                                              siempre es obligatoria la descripción
                                              El campo “Importe neto no gravado”
                                              <ImpTotConc>. No puede ser menor
                                              a cero (0).

                                              Para comprobantes tipo C debe ser
                                              igual a cero (0).
<ImpTotConc>                        10043
                                              Para comprobantes tipo 49 – Bienes
                                              usados, si el emisor es
                                              MONOTRIBUTISTA, este campo
                                              corresponde al importe del subtotal
                                              de la operación
                                              El campo “importe exento”
<ImpOpEx>                           10044     <ImpOpEx>. No puede ser menor a
                                              cero (0).

---

<!-- page 47 -->

                                                     Código
                  Campo / Grupo                                     Descripción de la validación
                                                     de error
                                                                Para comprobantes tipo C debe ser
                                                                igual a cero (0).

                                                                Para comprobantes tipo 49 – Bienes
                                                                usados, si se encuentra inscripto en
                                                                MONOTRIBUTO no debe informarse
                                                                o debe ser igual a cero (0).
                                                                El campo “Importe neto gravado”
                                                                <ImpNeto>. No puede ser menor a
                                                                cero (0).

                                                                Para comprobantes tipo C este
                                                                campo corresponde al Importe del
<ImpNeto>                                             10045
                                                                Sub Total.

                                                                Para comprobantes tipo 49 – Bienes
                                                                usados, si se encuentra inscripto en
                                                                MONOTRIBUTO no debe informarse
                                                                o debe ser igual a cero (0).
                                                                El campo “Importe de tributos”
<ImpTrib>                                             10046     <ImpTrib>. No puede ser menor a
                                                                cero (0).
                                                                El campo “Importe de IVA”
                                                                <ImpIVA>. No puede ser menor a
                                                                cero (0).

                                                                Para comprobantes tipo C debe ser
<ImpIVA>                                              10047     igual a cero (0).

                                                                Para comprobantes tipo 49 – Bienes
                                                                usados, si se encuentra inscripto en
                                                                MONOTRIBUTO no debe informarse
                                                                o debe ser igual a cero (0).
                                                                El campo “Importe Total”
                                                                <ImpTotal>, debe ser igual a la
                                                                suma de ImpTotConc + ImpNeto +
                                                                ImpOpEx + ImpTrib + ImpIVA

                                                                Para comprobantes tipo C, el campo
<ImpTotConc> / <ImpOpEx> / <ImpNeto> / <ImpTrib> /              “Importe Total” <ImpTotal>, debe
                                                      10048
<ImpIVA> / <ImpTotal>                                           ser igual a la suma de ImpNeto +
                                                                ImpTrib.

                                                                Para comprobantes tipo 49 – Bienes
                                                                Usados, si se encuentra inscripto en
                                                                MONOTRIBUTO el campo “Importe
                                                                Total” <ImpTotal>, debe ser igual a

---

<!-- page 48 -->

                                                 Código
                      Campo / Grupo                             Descripción de la validación
                                                 de error
                                                            la suma de ImpTotConc + ImpTrib.



                                                            Margen de error:

                                                            Error relativo porcentual deberá ser
                                                            <= 0.01% o el error absoluto <=0.01
                                                            Los campos <FchServDesde>,
                                                            <FchServHasta>, <FchVtoPago>, es
                                                            obligatorio cuando el campo
<FchServDesde> / <FchServHasta> / <FchVtoPago>    10049     <Concepto> es igual a 2 o 3.

                                                            Si se informa deberá tener el
                                                            siguiente formato yyyymmdd.
                                                            Los importes informados en AlicIVA
                                                            se deben corresponder según el tipo
                                                            de iva seleccionado. Para
                                                            comprobantes tipo 2, 3, 7, 8, 52 y 53
                                                            no se tiene en cuenta esta
<AlicIVA>                                         10051     validación.

                                                            Margen de error:

                                                            Error relativo porcentual deberá ser
                                                            <= 0.01% o el error absoluto <=0.01

                                                            No aplica para comprobantes tipo C
                                                            Si envía <Opcionales>, <Opcional> es
<Opcionales>                                      10052
                                                            obligatorio.
                                                            El campo <Id> en <Opcionales> es
                                                            obligatorio y debe ser alguno de los
<Opcional>                                        10053
                                                            devueltos por el método
                                                            FEParamGetTiposOpcional.
                                                            El campo <Id> en <Opcionales> es
                                                            obligatorio y no debe repetirse.
<Opcional>                                        10054     Solo pueden repetirse los
                                                            identificadores 1801 y 1802
                                                            informados para la RG 4004-E.
                                                            El campo <Valor> en Opcionales es
<Opcional>                                        10055
                                                            obligatorio
                                                            Que se informen los mismos con la
Importes en general                               10056
                                                            precisión indicada.
                                                            De enviarse el tag CbteAsoc debe
<CbteAsoc><Tipo>                                  10057
                                                            enviarse Tipo > a 0

---

<!-- page 49 -->

                                          Código
                     Campo / Grupo                       Descripción de la validación
                                          de error


                                                     De enviarse el tag CbteAsoc debe
<CbteAsoc><PtoVta>                         10058
                                                     enviarse PtoVta > a 0 y < a 99999
                                                     De enviarse el tag CbteAsoc debe
<CbteAsoc><Nro>                            10059
                                                     enviarse Nro > a 0 y < a 99999999
<CbteAsoc><Tipo> / <CbteAsoc><PtoVta> /              De enviarse el tag CbteAsoc, los
<CbteAsoc><Nro>                            10060     comprobantes no deben repetirse.


                                                     La suma de los campos <BaseImp>
                                                     en <AlicIva> debe ser igual al valor
                                                     ingresado en ImpNeto. Esta
                                                     validación no deberá ser tenida en
                                                     cuenta, cuando el <CbteTipo> sea
                                                     02, 03 ,07, 08, para comprobantes
                                                     tipo C (11, 12, 13, 15) y para
<ImpNeto> /                                          Comprobantes tipo “A con leyenda
                                           10061
<AlicIVA><BaseImp>                                   operación sujeta a retención” (52,
                                                     53)

                                                     Margen de error:

                                                     Error relativo porcentual deberá ser
                                                     <= 0.01% o el error absoluto <=0.01
                                                     * cantidad de alícuotas de IVA
                                                     ingresadas *
                                                     Si envía <CbtesAsoc>, <CbteAsoc> es
<CbtesAsoc><CbteAsoc>                      10062
                                                     obligatorio.

                                           10064     Si selecciona Id = 2 el valor ingresado
<Opcionales><Id><Valor>                              debe ser un numérico de 8 (ocho)
                                                     dígitos mayor o igual a 0 (cero).
                                                     El campo “Importe Total”
<ImpTotal>                                 10065     <ImpTotal>. No puede ser menor a
                                                     cero (0).
                                                     Si Id = 2 y el comprobante
                                                     corresponde a una actividad
                                                     alcanzada por el beneficio de
                                                     Promoción Industrial en el campo
<Opcionales><Id><Valor>                    10066     <Valor> se deberá informar el
                                                     número identificador del proyecto
                                                     (el mismo deberá corresponder a la
                                                     CUIT emisora del comprobante), si
                                                     no corresponde a una actividad
                                                     alcanzada por el beneficio el campo

---

<!-- page 50 -->

                                    Código
                    Campo / Grupo                  Descripción de la validación
                                    de error
                                               <Valor> deberá ser 0 (cero).

                                               El Id = 2 solo podrá informarse
                                               cuando <CbteTipo> es igual a 1, 2, 3,
                                               6, 7, 8.
                                               Para comprobantes tipo B, si
                                               <DocTipo> es 80 y <DocNro> es
<ImpTrib> <DocTipo><DocNro>          10067     23000000000 (No Categorizado),
                                               ImpTrib debe ser mayor a 0.


                                               El array <Opcionales> no es
                                               obligatorio. Solo puede informarse si
                                               <CbteTipo> es 1, 2, 3, 4, 6, 7, 8, 9,
<Opcionales><CbteTipo>               10068
                                               11,12, 13, 15, 49, 51, 52, 53, 54, 63,
                                               64, 201, 206, 211, 203, 208, 213,
                                               202, 207, 212.
                                               El N° de documento del receptor del
<DocNro>                             10069     comprobante no puede ser igual al
                                               del emisor.

<ImpNeto>/                                     Si el importe neto es mayor a cero,
                                     10070     es obligatorio informar el array de
<Iva>                                          iva.
                                               Si el tipo de comprobante es C, el
<Iva>                                10071
                                               array de IVA no debe informarse.
                                               Si el comprobante informado es tipo
                                               49 – Bienes Usados, el emisor del
                                               comprobante se encuentra inscripto
<CbteTipo>/<AlicIVA>                 10075
                                               en el MONOTRIBUTO. El objeto
                                               <IVA> y <AlicIva> no deben
                                               informarse.
                                               Si el comprobante informado es tipo
                                               49 – Bienes Usados, es obligatorio
<Opcionales><CbteTipo>/<DocTipo>     10076     informar opcionales.

                                               Ver                       método
                                               FEParamGetTiposOpcional()
                                               Si informa Id = 91 el valor ingresado
<Opcionales><Id>/                              no puede ser un blanco y debe ser
                                     10077
<Opcionales><Valor>                            un alfanumérico de 100 caracteres
                                               como máximo.
                                               Si el comprobante es del tipo 49 –
<Opcionales><Id>/<CbteTipo>          10078     Bienes Usados es obligatorio
                                               informar el Nombre y Apellido

---

<!-- page 51 -->

                                    Código
                    Campo / Grupo                  Descripción de la validación
                                    de error
                                               mediante el ID = 91.
                                               Si informa Id = 92 el valor ingresado
<Opcionales><Id>/                              debe ser un valor numérico de 3
                                     10079     posiciones.
<Opcionales><Valor>


                                               Si informa Id = 92, el contenido del
<Opcionales><Id>/                              campo <Valor> debe corresponder a
                                     10080
<Opcionales><Valor>                            un código de país valido. Ver
                                               método FEParamGetTiposPaises
                                               Si el comprobante es del tipo 49 –
<Opcionales><Id>/<CbteTipo>          10081     Bienes Usados, los valores posibles
                                               para el id son 91, 92, 93.
                                               Si en el campo TipoDoc se informa
                                               30, 91 o 94 se deberá informar el id
<Opcionales><Id>/                              92 con el código del país del
<CbteTipo>                           10082     vendedor. Consultar Método
                                               FEParamGetTiposPaises.

                                               Si TIPODOC es distinto de 30, 91 o 94
                                               no debe informarse el id 92.
                                               Si informa Id = 93, el valor ingresado
<Opcionales><Id>/                              no puede ser blanco y debe ser
                                     10083
<Opcionales><Valor>                            alfanumérico de 250 caracteres
                                               como máximo
                                               Si el comprobante es del tipo 49 –
                                               Bienes Usados es obligatorio
<Opcionales><Id>/<CbteTipo>          10084
                                               informar el Domicilio del
                                               receptor/vendedor el ID = 93.
                                               Para comprobantes tipo 49 – Bienes
<concepto>                           10085
                                               usados, solo informar 1 – Productos
                                               Si el comprobante es del tipo A (1, 2,
                                               3, 4, 5, 34, 39, 60, 63) e intenta
                                               informar datos opcionales según
<Opcionales><Id>/<CbteTipo>          10086
                                               Resolución General 3668, los valores
                                               posibles para los identificadores son
                                               5, 61, 62, 7.

<Opcionales><Id>/                              Si informa Id = 5, el valor ingresado
                                     10088     no puede ser blanco y debe ser
<Opcionales><Valor>                            alfanumérico de 2 caracteres.
<Opcionales><Id>/                              Si informa Id = 5, el contenido del
                                     10089     campo <Valor> debe corresponder a
<Opcionales><Valor>
                                               un código de EXCEPCION válido

---

<!-- page 52 -->

                                    Código
                    Campo / Grupo                  Descripción de la validación
                                    de error
                                               comprendido por alguno de los sig:

                                               01 – Locador / Prestador del mismo

                                               02 – Congresos / Eventos

                                               03 – Operación contemplada en RG
                                               74

                                               04 – Bienes de Cambio

                                               05 – Ropa de trabajo

                                               06 – Intermediario

<Opcionales><Id>/                              Si informa Id = 61, el valor ingresado
                                     10090     no puede ser blanco y debe ser
<Opcionales><Valor>                            numérico de 2 caracteres.
                                               Si informa Id = 61, el contenido del
<Opcionales><Id>/                              campo <Valor> debe corresponder a
                                     10091     un código que represente el tipo de
<Opcionales><Valor>                            documento del firmante. Ver
                                               método FEParamGetTiposDoc.
                                               Si informa Id = 62, el valor ingresado
<Opcionales><Id>/                              no puede ser blanco y debe ser
                                     10092
<Opcionales><Valor>                            numérico de 11 caracteres como
                                               máximo.
<Opcionales><Id>/                              Se encuentra dado de baja mediante
                                     10093     redmine RM57235
<Opcionales><Valor>

<Opcionales><Id>/                              Si informa Id = 7, el valor ingresado
                                     10094     no puede ser blanco y debe ser
<Opcionales><Valor>                            numérico de 2 caracteres.
                                               Si informa Id = 7, el contenido del
                                               campo <Valor> debe corresponder a
                                               un código de carácter firmante
                                               válido comprendido por alguno de
<Opcionales><Id>/                              los sig:
                                     10095
<Opcionales><Valor>                            01 – Titular

                                               02 – Director / Presidente

                                               03 – Apoderado

                                               04 – Empleado
                                               Para comprobantes tipo C, si el
<PtoVta> / <CbteTipo>                10096     contribuyente se encuentra
                                               registrado en las bases del

---

<!-- page 53 -->

                                    Código
                    Campo / Grupo                  Descripción de la validación
                                    de error
                                               organismo como exento, el punto de
                                               venta a utilizar al momento de
                                               autorizar el comprobante debe ser
                                               del tipo “COMPROBANTES – EXENTO
                                               EN IVA – WEB SERVICES”.
                                               Si informa id = 10 (RG 3.368
                                               Establecimientos de educación
                                               pública de gestión privada), el valor
<Opcionales><Id>/                              ingresado no puede ser blanco y
                                     10097
<Opcionales><Valor>                            debe ser un numerico de 1 carácter:

                                               0 – Actividades no comprendidas

                                               1 – Actividades comprendidas
                                               Si informa id = 1011 (RG 3.368
                                               Establecimientos de educación
<Opcionales><Id>/                              pública de gestión privada), el valor
                                     10098     ingresado no puede ser blanco y
<Opcionales><Valor>                            debe corresponder al tipo de
                                               documento del titular del pago. Ver
                                               método FEParamGetTiposDoc.
                                               Si informa id = 1012 (RG 3.368
                                               Establecimientos de educación
                                               pública de gestión privada), el valor
                                               ingresado no puede ser blanco y
<Opcionales><Id>/                              debe corresponder al n° de
                                     10099     documento del titular del pago.
<Opcionales><Valor>                            Numérico de 11 caracteres como
                                               máximo para tipo de documento 80,
                                               86, 87, 96 o alfanumérico de 20
                                               como máximo para el resto de los
                                               tipos de documentos.
                                               Si informa id = 11 (RG 2.820
                                               Operaciones económicas vinculadas
                                               con bienes inmuebles), el valor
<Opcionales><Id>/                              ingresado no puede ser blanco y
                                     10110
<Opcionales><Valor>                            debe ser un numérico de 1 carácter:

                                               0 – Actividades no comprendidas

                                               1 – Actividades comprendidas
                                               Si informa id = 12 (RG 3.687
<Opcionales><Id>/                              Locación temporaria de inmuebles
                                     10111     con fines turísticos), el valor
<Opcionales><Valor>                            ingresado no puede ser blanco y
                                               debe ser un numérico de 1 carácter:

---

<!-- page 54 -->

                                    Código
                    Campo / Grupo                  Descripción de la validación
                                    de error
                                               0 – Actividades no comprendidas

                                               1 – Actividades comprendidas
                                               Si intenta informar datos opcionales
                                               según Resolución General:

                                               RG 3.368 Establecimientos de
                                               educación pública de gestión privada
                                               (identificador 10)

                                               RG 2.820 Operaciones económicas
                                               vinculadas con bienes inmuebles
                                               (identificador 11)

                                               RG 3.687 Locación temporaria de
                                               inmuebles con fines turísticos
                                               (identificador 12).

                                               RG 2.863 Representantes de
                                               Modelos (identificador 13).
<Opcionales><Id>                               RG 2.863 Agencias de publicidad
                                     10112     (identificador 14).

                                               RG 2.863 Personas físicas que
                                               desarrollen actividad de modelaje
                                               (identificador 15).

                                               RG 4004-E Alquiler de inmuebles con
                                               destino casa habitación
                                               (identificador 17, en caso de ser
                                               necesario informar titular o
                                               cotitular, el identificador que
                                               acompaña al 17 es el 1801 y 1802).

                                               Recordar que en un mismo
                                               comprobante solo puede informar
                                               identificadores opcionales para solo
                                               1 resolución por comprobante.


                                               Si informa id = 10 (RG 3.368
                                               Establecimientos de educación
                                               pública de gestión privada) con valor
<Opcionales><Id>/                              “1 – Actividades comprendidas”
                                     10113
<Opcionales><Valor>                            Informar

                                                       1011 – Tipo de Documento

                                                       1012 – N° de documento

---

<!-- page 55 -->

                                    Código
                    Campo / Grupo                  Descripción de la validación
                                    de error
                                               Si informa id = 10 (RG 3.368
                                               Establecimientos de educación
                                               pública de gestión privada) con valor
                                               “0 – Actividades No comprendidas”

                                               No informar

                                                       1011 – Tipo de Documento

                                                       1012 – N° de documento
                                               Si informa id = 1011 o 1012 (RG
                                               3.368 Establecimientos de educación
<Opcionales><Id>/                              pública de gestión privada) es
                                     10114
<Opcionales><Valor>                            obligatorio informar el identificador
                                               que representa si se encuentra
                                               comprendida (id = 10, valor = 1)
                                               Si informa id = 10 (RG 3.368
                                               Establecimientos de educación
                                               pública de gestión privada) con valor
                                               “1 – Actividades comprendidas” e
                                               informa
<Opcionales><Id>/                              ID = 1011 (Tipo de Documento) con
                                     10115     un valor que se corresponde al 80,
<Opcionales><Valor>
                                               86, 87, 96 (CUIT, CUIL, CDI, DNI
                                               respectivamente), deberá
                                               verificarse que el número
                                               consignado en el ID = 1012 (n° de
                                               documento del titular del pago), se
                                               encuentra en los padrones de arca.
                                               Si informa id = 13 (RG 2.863
                                               Representantes de Modelos), el
                                               valor ingresado no puede ser blanco
<Opcionales><Id>/                              y debe ser un numérico de 1
                                     10116
<Opcionales><Valor>                            carácter:

                                               0 - Actividades no comprendidas

                                               1 - Actividades comprendidas
                                               Si informa id = 14 (RG 2.863
                                               Agencias de publicidad), el valor
<Opcionales><Id>/                              ingresado no puede ser blanco y
                                     10117     debe ser un numérico de 1 carácter:
<Opcionales><Valor>
                                               0 - Actividades no comprendidas

                                               1 - Actividades comprendidas
<Opcionales><Id>/                    10118     Si informa id = 15 (RG 2.863

---

<!-- page 56 -->

                                          Código
                    Campo / Grupo                        Descripción de la validación
                                          de error
                                                     Personas físicas que desarrollen
                                                     actividad de modelaje), el valor
                                                     ingresado no puede ser blanco y
                                                     debe ser un numérico de 1 carácter:
<Opcionales><Valor>
                                                     0 - Actividades no comprendidas

                                                     1 - Actividades comprendidas
                                                     Si la moneda es <> PES, el tipo de
                                                     cambio no podrá ser inferior al 2% ni
                                                     superior en un 400% del que
<MonId>/<MonCotiz>                         10119     suministra arca como orientativo de
                                                     acuerdo a la cotización oficial.

                                                     Para poder obtener la cotización ver
                                                     Metodo FEParamGetCotizacion.
                                                     Si informa comprobantes asociados,
<CbteAsoc><Tipo> / <CbteAsoc><PtoVta> /              y sus códigos son 91, 88, 988, 990,
<CbteAsoc><Nro>                            10120     991, 993, 994, 995, 996, 997, los
                                                     mismos deben encontrarse
                                                     registrados.
                                                     Si informa comprobantes asociados,
<CbteAsoc><Tipo> / <CbteAsoc><PtoVta> /              y sus códigos son 91, 88, 988, 990,
<CbteAsoc><Nro>                            10121     991, 993, 994, 995, 996, 997, los
                                                     mismos deben encontrarse
                                                     confirmados.
                                                     Si informa comprobantes asociados
                                                     y sus códigos son 91, 88, 988, 990,
<DocTipo> / <DocNro>                                 991, 993, 994, 995, 996, 997, el
                                           10122
<CbteAsoc><Cuit>                                     receptor del comprobante a
                                                     autorizar debe ser igual al receptor
                                                     del comprobante asociado.
                                                     Si el comprobante es del tipo B o C e
<Opcionales><Id>/                                    intenta informar datos opcionales
                                           10123     según Resolución General 4004-E,
<Opcionales><Valor>                                  los valores posibles para los
                                                     identificadores son 17, 1801, 1802.
                                                     Si informa id = 17 (RG 4004-E
                                                     Locación de inmuebles destino
                                                     "casa-habitación"), el valor
<Opcionales><Id>/
                                           10124     ingresado no puede ser blanco y
<Opcionales><Valor>                                  debe ser un numérico de 1 carácter:

                                                     1 (uno) = facturación a través de
                                                     intermediario

---

<!-- page 57 -->

                                    Código
                    Campo / Grupo                  Descripción de la validación
                                    de error
                                               2 (dos) = facturación directa
                                               Si informa id = 1801 (RG 4004-E
                                               Locación de inmuebles destino
<Opcionales><Id>/                              "casa-habitación"), el valor
                                     10125     ingresado no puede ser blanco y
<Opcionales><Valor>                            debe corresponder al CUIT del
                                               propietario/locador. Numérico de 11
                                               caracteres.
                                               Si informa Id = 1801 (RG 4004-E
<Opcionales><Id>/                              Locación de inmuebles destino
                                     10126     "casa-habitación"), verificar que el
<Opcionales><Valor>                            número consignado se encuentra en
                                               los padrones de arca.
                                               Si informa Id = 1802 (RG 4004-E
                                               Locación de inmuebles destino
                                               "casa-habitación") el valor ingresado
<Opcionales><Id>/                              no puede ser un blanco y debe ser
                                     10127
<Opcionales><Valor>                            un alfanumérico de 100 caracteres
                                               como máximo que representa el
                                               Nombre y Apellido
                                               propietario/locador.
                                               Si informa Id = 1801 (RG 4004-E
                                               Locación de inmuebles destino
<Opcionales><Id>/                              "casa-habitación") con un CUIT
                                     10128
<Opcionales><Valor>                            propietario/locador no repetirlo
                                               dentro de la lista de
                                               propietarios/locadores.
                                               Si informa id 17 con valor 1
                                               (Intermediario) (RG 4004-E Locación
                                               de inmuebles destino "casa-
                                               habitación"), deben informarse
                                               obligatoriamente los identificadores
<Opcionales><Id>/                              1801 y 1802.
                                     10129
<Opcionales><Valor>                            Si informa id 17 con valor 2 (Directo)
                                               (RG 4004-E Locación de inmuebles
                                               destino "casa-habitación"), pueden
                                               no informarse los identificadores
                                               1801, 1802. Solo informarlos cuando
                                               hay otro/s propietarios/locadores.
                                               Si informa id 1801 y id 1802 (RG
<Opcionales><Id>/
                                     10130     4004-E Locación de inmuebles
<Opcionales><Valor>                            destino "casa-habitación"), la
                                               cantidad de opcionales con id 1801 y

---

<!-- page 58 -->

                                      Código
                    Campo / Grupo                    Descripción de la validación
                                      de error
                                                 1802 deben ser iguales.
                                                 Si informa Id = 1801 (RG 4004-E
<Opcionales><Id>/                                Locación de inmuebles destino
                                                 "casa-habitación") con un CUIT
<Opcionales><Valor>                    10131
                                                 propietario/locador no puede ser el
<Auth><Cuit>                                     mismo que el emisor del
                                                 comprobante.
                                                 Si informa id 1801 y id 1802 (RG
<Opcionales><Id>/                                4004-E Locación de inmuebles
                                       10132     destino "casa-habitación"), es
<Opcionales><Valor>                              obligatorio informar el id 17 con
                                                 valor 1 (Intermediario) o 2 (Directo).
                                                 Si envía compradores, comprador es
<Compradores>/<Comprador>              10133
                                                 obligatorio y no debe ser vacío.

<FeCabReq><CbteTipo>/                            La estructura compradores se
                                       10134     encuentra habilitada para
<Compradores>                                    comprobantes tipo A, B, C o M.
                                                 Si envía compradores, el tipo de
<Compradores>/<Comprador>/<DocTipo>    10135     documento del comprador es
                                                 obligatorio informarlo.
                                                 Solo informar compradores cuando
<FECAEDetRequest><DocTipo>/                      el tipo de documento del receptor
                                       10136
<Compradores>                                    del comprobante es 80, 86, 87
                                                 (CUIT, CUIL, CDI respectivamente).
                                                 Los tipos de documentos habilitados
                                                 a informar sobre el comprador son
<Compradores>/<Comprador>/<DocTipo>    10137
                                                 80, 86, 87 (CUIT, CUIL, CDI
                                                 respectivamente).
                                                 Si envía compradores, el número de
<Compradores>/<Comprador>/<DocNro>     10138     documento del comprador es
                                                 obligatorio informarlo.
                                                 Si envía compradores, el número de
                                                 documento debe ser un documento
<Compradores>/<Comprador>/<DocNro>     10139
                                                 con formato válido, numérico de 11
                                                 caracteres.
                                                 Si envía compradores, el número de
<Auth>/<Cuit>                                    documento del comprador no puede
                                       10140
<Compradores>/<Comprador>/<DocNro>               ser igual al número de documento
                                                 del emisor del comprobante
                                                 Si envía compradores, los mismos no
<Compradores>/<Comprador>              10141
                                                 pueden repetirse en la lista.

---

<!-- page 59 -->

                                         Código
                   Campo / Grupo                        Descripción de la validación
                                         de error
                                                    Si envía compradores, el porcentaje
<Compradores>/<Comprador>/<Porcentaje>    10142     de titularidad del comprador es
                                                    obligatorio informarlo.
                                                    Si envía compradores, el porcentaje
                                                    de titularidad debe ser un valor
<Compradores>/<Comprador>/<Porcentaje>    10143     numérico de 2 enteros y 2
                                                    decimales, los cuales deben ser
                                                    valores mayores a cero.
                                                    Si envía compradores, el porcentaje
<Compradores>/<Comprador>/<Porcentaje>    10144
                                                    de titularidad debe ser mayor a cero.
                                                    Si envía compradores, los
                                                    compradores informados deben ser
<Compradores>/<Comprador>                 10145
                                                    al menos 2. Uno de los dos debe ser
                                                    el receptor del comprobante.
<FECAEDetRequest><DocTipo>                          Si envía compradores, el comprador
                                                    de mayor porcentaje de titularidad
<FECAEDetRequest><DocNro>
                                          10146     debe coincidir con el receptor del
<Compradores>/<Comprador>/<DocTipo>                 comprobante.

<Compradores>/<Comprador>/<DocNro>
                                                    Si envía compradores, la sumatoria
<Compradores>/<Comprador>/<Porcentaje>    10147     de todos los porcentajes de
                                                    titularidad debe ser del 100%.
                                                    Si envía compradores, los
                                                    compradores deben encontrarse
<Compradores>/<Comprador>/<DocNro>        10148
                                                    registrados en el padrón de arca, en
                                                    condición activa.
                                                    Si envía compradores, y el tipo de
                                                    comprobante es “A” o “A con
                                                    leyenda operación sujeta a
                                                    retención”, el receptor o al menos
<Compradores>/<Comprador>/<DocNro>        10149     uno de los compradores deben
                                                    encontrarse registrados de forma
                                                    activa en el Impuesto al Valor
                                                    Agregado o Responsable
                                                    Monotributo.
<FECAEDetRequest><Concepto>/                        Solo enviar compradores cuando el
                                          10150     concepto es 1 – PRODUCTO
<Compradores>
                                                    Si informa Cuit en comprobantes
                                                    asociados, no informar en blanco, el
<CbteAsoc><Cuit>                          10151
                                                    mismo debe ser un valor de 11
                                                    caracteres numéricos.

---

<!-- page 60 -->

                                      Código
                 Campo / Grupo                       Descripción de la validación
                                      de error
                                                 Para comprobante del tipo MiPyMEs
                                                 (FCE) del tipo débito o crédito es
                                                 obligatorio informar el campo.
                                                 Si informa fecha de comprobante
                                                 <CbteFch> para el Concepto del tipo
                                                 “01 – Productos” con fecha superior
                                                 a la fecha de envío de autorización,
                                                 el mes de la fecha del comprobante
                                                 <CbteFch> debe coincidir con el mes
                                                 de la fecha de envío de autorización.

                                                 Si informa fecha de comprobante
<CbteFch>/<Concepto>                   10152
                                                 <CbteFch> para comprobantes del
                                                 tipo MiPyMEs (FCE) con fecha
                                                 superior a la fecha de envío de
                                                 autorización, el mes de la fecha del
                                                 comprobante <CbteFch> debe
                                                 coincidir con el mes de la fecha de
                                                 envío de autorización.


                                                 Si el tipo de comprobante que está
<FeCabReq><CbteTipo>/                            autorizando es MiPyMEs (FCE) y
                                       10153     corresponde a un comprobante de
<FECAEDetRequest><CbtesAsoc>                     débito o crédito, es obligatorio
                                                 informar comprobantes asociados.
                                                 Si el tipo de comprobante que está
                                                 autorizando es MiPyMEs (FCE) y
                                                 corresponde a un comprobante de
                                                 débito o crédito. Tener en cuenta
                                                 que:

                                                 - sí el comprobante asociado se
                                                 encuentra rechazado por el
                                                 comprador hay que informar el
<FeCabReq><CbteTipo>/                            código de anulación
                                       10154     correspondiente sobre el campo
<CbteAsoc><Tipo><PtoVta><Nro><Cuit>              "Adicionales por RG", códigos 22 -
                                                 Anulación. Valor “S”

                                                 - sí el comprobante asociado no se
                                                 encuentra rechazado por el
                                                 comprador hay que informar el
                                                 código de no anulación
                                                 correspondiente sobre el campo
                                                 "Adicionales por RG", códigos 22 -
                                                 Anulación. Valor “N”

---

<!-- page 61 -->

                                   Código
                   Campo / Grupo                  Descripción de la validación
                                   de error
                                              Si el tipo de comprobante que está
<Auth><Cuit>                                  autorizando es MiPyMEs (FCE), el
                                              CUIT del emisor del comprobante
<FeCabReq><CbteTipo>/               10155
                                              asociado debe coincidir con el CUIT
<CbteAsoc><Cuit>                              del emisor del comprobante a
                                              autorizar.
                                              Si el tipo de comprobante que está
<FeCabReq><CbteTipo>/                         autorizando es MiPyMEs (FCE),
                                    10156     Débito o Crédito sin código de
<CbteAsoc><Tipo>                              Anulación siempre debe asociar 1
                                              comprobante tipo factura
                                              Si el tipo de comprobante que está
                                              autorizando es MiPyMEs (FCE),
                                              Débito o Crédito sin código de
                                              Anulación solo puede asociar:

                                              Para comprobantes A, asociar 201 o
                                              (91, 88, 988, 990, 991, 993, 994, 995,
<FeCabReq><CbteTipo>/
                                    10157     996, 997).
<CbteAsoc><Tipo>
                                              Para comprobantes B, asociar 206 o
                                              (91, 88, 988, 990, 991, 993, 994, 995,
                                              996, 997).

                                              Para comprobantes C, asociar 211 o
                                              (91, 88, 988, 990, 991, 993, 994, 995,
                                              996, 997).
                                              Si el tipo de comprobante que está
<FeCabReq><CbteTipo>/
                                              autorizando es MiPyMEs (FCE),
<CbteAsoc> / <Tipo> / <PtoVta> /    10158     Débito o Crédito, es obligatorio
                                              informar la fecha del comprobante
<Nro> / <Cuit> / <CbteFch>
                                              asociado
<FeCabReq><CbteTipo>/                         Si el tipo de comprobante que está
                                              autorizando es MiPyMEs (FCE),
<FeDetReq>/<CbteFch>/
                                              Débito o Crédito, la fecha del
<CbteAsoc> / <Tipo> / <PtoVta> /    10159     comprobante asociado tiene que ser
                                              igual o menor a la fecha del
<Nro> / <Cuit> / <CbteFch>                    comprobante que se está
                                              autorizando

                                              Si el tipo de comprobante que está
<FeCabReq><CbteTipo>/                         autorizando es MiPyMEs (FCE),
                                              Débito o Crédito, el comprobante
<CbteAsoc> / <Tipo> / <PtoVta> /    10160
                                              debe existir autorizado en las bases
<Nro> / <Cuit> / <CbteFch>                    de esta Administración con la misma
                                              fecha informada en el asociado.

---

<!-- page 62 -->

                                            Código
                  Campo / Grupo                            Descripción de la validación
                                            de error
                                                       Si el tipo de comprobante que está
<FeCabReq><CbteTipo>/                                  autorizando es MiPyMEs (FCE), el
                                             10161     receptor del comprobante debe
<FECAEDetRequest><DocTipo><DocNro>                     tener habilitado el domicilio fiscal
                                                       electrónico

<FeCabReq><CbteTipo>/                                  Si el tipo de comprobante que está
                                             10162     autorizando es MiPyMEs (FCE)
<Opcionales>                                           es obligatorio informar <Opcionales>
                                                       Si el tipo de comprobante que está
                                                       autorizando es MiPyMEs (FCE), Tipo
                                                       201 - FACTURA DE CREDITO ELEC-
<FeCabReq><CbteTipo>/                                  TRONICA MiPyMEs (FCE) A / 206 -
                                             10163     FACTURA DE CREDITO ELECTRONICA
<FchVtoPago>
                                                       MiPyMEs (FCE) B / 211 - FACTURA
                                                       DE CREDITO ELECTRONICA MiPyMEs
                                                       (FCE) C, es obligatorio informar Fch-
                                                       VtoPago
                                                       Si el tipo de comprobante que está
                                                       autorizando es MiPyMEs (FCE), la fe-
<FeCabReq><CbteTipo>/                                  cha de vencimiento de pago <FchV-
                                             10164     toPago> debe ser posterior o igual a
<FchVtoPago> / <FECAEDetRequest><CbteFch>
                                                       la fecha de emisión <CbteFch> o fe-
                                                       cha de presentación (fecha actual),
                                                       la que sea posterior
                                                       Si el tipo de comprobante que está
<FeCabReq><CbteTipo>/                                  autorizando es MiPyMEs (FCE), in-
                                             10165     forma opcionales, el valor correcto
<Opcionales><Id><Valor>
                                                       para el código 2101 es un CBU nu-
                                                       mérico de 22 caracteres.
                                                       Si el tipo de comprobante que está
<FeCabReq><CbteTipo>/                                  autorizando es MiPyMEs (FCE), in-
                                             10166     forma opcionales, el valor correcto
<Opcionales><Id><Valor>
                                                       para el código 2102 es un ALIAS alfa-
                                                       numérico de 6 a 20 caracteres.
                                                       Si el tipo de comprobante que está
                                                       autorizando es MiPyMEs (FCE), in-
<FeCabReq><CbteTipo>/
                                             10167     forma opcionales, el valor correcto
<Opcionales><Id><Valor>                                para el código 22 es “S” o “N”:
                                                       S = Es de Anulación
                                                       N = No es de Anulación
                                                       Si el tipo de comprobante que está
<FeCabReq><CbteTipo>/                                  autorizando es Factura (201, 206,
                                             10168     211) del tipo MiPyMEs (FCE), infor-
<Opcionales><Id><Valor>
                                                       ma opcionales, es obligatorio infor-
                                                       mar CBU.
<FeCabReq><CbteTipo>/                        10169     Si el tipo de comprobante que está

---

<!-- page 63 -->

                                  Código
                  Campo / Grupo                  Descripción de la validación
                                  de error
                                             autorizando NO es MiPyMEs (FCE),
                                             no informar los códigos 2101, 2102,
<Opcionales><Id><Valor>
                                             22, 27
                                             Si el tipo de comprobante que está
<FeCabReq><CbteTipo>/
                                   10170     autorizando es MiPyMEs (FCE), es
<Opcionales><Id><Valor>                      obligatorio informar al menos uno
                                             de los sig. códigos 2101, 22, 27.
                                             Si el tipo de comprobante que está
<FeCabReq><CbteTipo>/
                                   10171     autorizando es MiPyMEs (FCE), Fac-
<Opcionales><Id><Valor>                      tura (201, 206, 211), no informar Có-
                                             digo de Anulación
                                             Si el tipo de comprobante que está
<FeCabReq><CbteTipo>/                        autorizando es MiPyMEs (FCE), Debi-
                                   10172     to (202, 207, 212) o Crédito (203,
<Opcionales><Id><Valor>
                                             208, 213) No informar CBU, ALIAS y
                                             Transferencia.
                                             Si el tipo de comprobante que está
<FeCabReq><CbteTipo>/                        autorizando es MiPyMEs (FCE), Debi-
                                   10173     to (202, 207, 212) o Crédito (203,
<Opcionales><Id><Valor>
                                             208, 213) informar Código de Anula-
                                             ción
                                             Si el tipo de comprobante que está
                                             autorizando es factura MiPyMEs
<FeCabReq><CbteTipo>/
                                   10174     (FCE), el CBU debe estar registrado
<Opcionales><Id><Valor>                      en las bases de esta administración,
                                             vigente y pertenecer al emisor del
                                             comprobante.
                                             Si el tipo de comprobante que está
                                             autorizando es MiPyMEs (FCE), el
                                             campo “fecha de vencimiento para
<FeCabReq><CbteTipo>/                        el pago” <FchVtoPago> no debe
                                   10175
<FchVtoPago>                                 informarse si NO es Factura de
                                             Crédito. En el caso de ser Débito o
                                             Crédito, solo puede informarse si es
                                             de Anulación.
                                             Si el tipo de comprobante que está
<FeCabReq><CbteTipo>/                        autorizando es MiPyMEs (FCE), el
                                   10176     campo DocNro para comprobantes
<CbteTipo> / <DocNro>                        deberá ser un valor registrado en el
                                             padrón de arca, en condición activa.
                                             Si el tipo de comprobante que está
                                             autorizando es MiPyMEs (FCE) del
<FeCabReq><CbteTipo>/
                                   10177     tipo A, el receptor del comprobante
<CbteTipo> / <DocNro>                        informado en DocTipo y DocNro
                                             debe corresponder a un
                                             contribuyente activo en el Impuesto

---

<!-- page 64 -->

                                      Código
                  Campo / Grupo                      Descripción de la validación
                                      de error
                                                 al Valor Agregado.

                                                 Si el tipo de comprobante que está
                                                 autorizando es MiPyMEs (FCE) del
                                                 tipo B, el receptor del comprobante
                                                 informado en DocTipo y DocNro
                                                 debe corresponder a un
                                                 contribuyente activo en el Impuesto
                                                 Iva, Monotributo o Exento.

                                                 Si el tipo de comprobante que está
                                                 autorizando es MiPyMEs (FCE) del
                                                 tipo C, el receptor del comprobante
                                                 informado en DocTipo y DocNro
                                                 debe corresponder a un
                                                 contribuyente activo en el Impuesto
                                                 Iva, Monotributo o Exento.
                                                 Si el tipo de comprobante que está
<FeCabReq><CbteTipo>/                            autorizando es MiPyMEs (FCE) no se
                                       10178
<CbteTipo> / <DocNro>                            permite informar DocNro
                                                 23000000000 (No Categorizado)
                                                 Si el tipo de comprobante que está
                                                 autorizando es MiPyMEs (FCE), el
                                                 receptor del comprobante
                                                 informado en DocTipo y DocNro
<FeCabReq><CbteTipo>/                            debe corresponder a un
                                       10180
<CbteTipo> / <DocNro>                            contribuyente caracterizado como
                                                 GRANDE o que opto por PYME. Su
                                                 activida principal debe
                                                 corresponderse con alguna de las
                                                 alcanzadas por el régimen.
                                                 Si el tipo de comprobante que está
                                                 autorizando es MiPyMEs (FCE), débi-
<FeCabReq><CbteTipo>/<MonId>                     to o crédito, el mismo debe tener la
                                                 misma moneda que el comprobante
<CbteAsoc>                             10181
                                                 asociado o Pesos para ajuste en las
                                                 diferencias de cambio (post acepta-
                                                 ción/rechazo)

                                                 Si el tipo de comprobante que está
<FeCabReq><CbteTipo>/                            autorizando es MiPyMEs (FCE), es
                                                 débito o crédito, deben coincidir
<FECAEDetRequest><DocTipo><DocNro>/    10183
                                                 emisores y receptores.
<CbteAsoc>
                                                 Si el comprobante ES de anulación,
                                                 para autorizar un débito, el tipo de

---

<!-- page 65 -->

                                     Código
                  Campo / Grupo                     Descripción de la validación
                                     de error
                                                comprobante a asociar debe ser
                                                crédito y para autorizar un crédito,
                                                el tipo de comprobante a asociar
                                                debe ser una factura o un débito.
                                                Si el tipo de comprobante que está
                                                autorizando es MiPyMEs (FCE), es
<FeCabReq><CbteTipo>/<MonId>
                                                crédito el monto del comprobante a
<CbteAsoc>/                           10184     autorizar no puede ser mayor o igual
                                                al saldo actual de la cuenta
<FeCabReq><ImpTotal>
                                                corriente. Ver micrositio factura de
                                                crédito
                                                Si el tipo de comprobante que está
                                                autorizando es MiPyMEs (FCE), es
<FeCabReq><CbteTipo>/                           crédito o débito A, de anulación,
                                                solo se encuentra habilitado asociar
<CbteAsoc>/                           10186
                                                un comprobante de crédito A.
                                                Utilizar debito para anular crédito o
                                                utilizar crédito para anular débito o
                                                factura.
                                                Si el tipo de comprobante que está
                                                autorizando es MiPyMEs (FCE), es
<FeCabReq><CbteTipo>/                           crédito o débito B, de anulación,
                                                solo se encuentra habilitado asociar
<CbteAsoc>/                           10187
                                                un comprobante de crédito B.
                                                Utilizar debito para anular crédito o
                                                utilizar crédito para anular débito o
                                                factura.
                                                Puede identificar una o varias
<FeCabReq><CbteTipo>/                           Referencias Comerciales según
                                      10189     corresponda. Informar bajo el
<Opcionales><Id><Valor>                         código 23. Campo alfanumérico de
                                                50 caracteres como máximo.

<FeCabReq><CbteTipo>/                           Si informa opcionales con más de un
                                      10190     identificador 23 – Referencia
<Opcionales><Id><Valor>                         Comercial, no repetir el valor.
<Auth><Cuit>/                                   Según la categorización de las CUITs
                                      10192
                                                emisora y receptora y el monto
<FeCabReq><CbteTipo>/
                                                facturado debe realizar una factura
<FECAEDetRequest><DocNro>/                      de crédito electrónica MiPyMEs
                                                (FCE). Ver micrositio.
<FECAEDetRequest><ImpTotal> /
<FECAEDetRequest><MonCotiz> / Tope

<FeCabReq><CbteTipo>/                 10193     Si el tipo de comprobante que está
                                                autorizando es MiPyMEs (FCE), es

---

<!-- page 66 -->

                                           Código
                 Campo / Grupo                            Descripción de la validación
                                           de error
                                                      crédito o débito C, de anulación,
                                                      solo se encuentra habilitado asociar
<CbteAsoc>/                                           un comprobante de crédito C.
                                                      Utilizar debito para anular crédito o
                                                      utilizar crédito para anular débito o
                                                      factura.
                                                      Si el tipo de comprobante que está
<FeCabReq><CbteTipo>/                                 autorizando es MiPyMEs (FCE), no se
                                            10194
<Compradores>                                         encuentra habilitado informar
                                                      compradores.
<DocTipo>/                                            Si el tipo de documento del receptor
                                                      del comprobante que está
<DocNro>/
                                                      autorizando es CUIT (código Tipo de
                                            10195     Documento 80) y la CUIT se
                                                      encuentra inactiva por haber sido
                                                      incluida en la consulta de facturas
                                                      apócrifas.
                                                      Si el tipo de comprobante que está
<FeCabReq><CbteTipo>/                                 autorizando es MiPyMEs (FCE), no se
                                            10196
<FECAEDetRequest><PeriodoAsoc>                        encuentra habilitado informar
                                                      PeriodoAsoc.
                                                      Si el comprobante es Debito o
<FeCabReq><CbteTipo>/                                 Credito, se deberá informar de
                                                      forma obligatoria los campos Fecha
<FECAEDetRequest><CbtesAsoc>/               10197
                                                      Comprobantes Asociados
<FECAEDetRequest><PeriodoAsoc>                        Desde/Hasta, o al menos un
                                                      comprobante asociado.
                                                      Si el comprobante es Factura no se
<FeCabReq><CbteTipo>/                                 deberá informar los campos Fecha
                                            10198
<FECAEDetRequest><PeriodoAsoc>                        Comprobantes Asociados
                                                      Desde/Hasta
                                                      Si envía estructura <PeriodoAsoc> es
<FECAEDetRequest><PeriodoAsoc><FchDesde>    10199
                                                      obligatorio enviar <FchDesde>.
                                                      Si envía estructura <PeriodoAsoc> es
<FECAEDetRequest><PeriodoAsoc><FchHasta>    10203
                                                      obligatorio enviar <FchHasta>.
                                                      El campo <PeriodoAsoc>
                                                      <FchDesde> debe corresponder a
<FECAEDetRequest><PeriodoAsoc><FchDesde>    10204
                                                      una fecha valida con formato
                                                      YYYYMMDD
                                                      El campo PeriodoAsoc.FchHasta
<FECAEDetRequest><PeriodoAsoc><FchHasta>    10205     debe corresponder a una fecha
                                                      valida con formato YYYYMMDD

---

<!-- page 67 -->

                                            Código
                  Campo / Grupo                            Descripción de la validación
                                            de error

<FECAEDetRequest><PeriodoAsoc><FchDesde>/              Las fechas informadas en
                                             10206     <PeriodoAsoc> deben ser superiores
<FECAEDetRequest><PeriodoAsoc><FchHasta>               a 01/01/2006

<FECAEDetRequest><PeriodoAsoc><FchDesde>/              Las fechas informadas en
                                             10207     <PeriodoAsoc>,<FchHasta> debe ser
<FECAEDetRequest><PeriodoAsoc><FchHasta>               superior o igual a <FchDesde>.
                                                       Las fecha informada en
                                                       <PeriodoAsoc>.<FchHasta> debe ser
<FECAEDetRequest><PeriodoAsoc><FchHasta>     10208     anterior o igual a la fecha de emisión
                                                       del comprobante que estamos
                                                       autorizando
                                                       Si el comprobante asociado se
                                                       autorizó de forma electrónica y tiene
<FECAEDetRequest><CbteFch>/                            una fecha de emisión posterior a la
                                             10210     fecha de emisión del comprobante
<FECAEDetRequest><CbtesAsoc><CbteFch>                  por el cual se está solicitando la
                                                       autorización, ambos deberán ser del
                                                       mismo mes/año.
                                                       Informar de forma obligatoria la
                                                       fecha de Emisión del comprobante
                                                       asociado si el punto de venta del
                                                       comprobante asociado es
<FECAEDetRequest><CbtesAsoc><CbteFch>        10211
                                                       Controlador Fiscal o FactuWeb y el
                                                       tipo de Comprobante asociado es
                                                       Factura, Recibo, Nota de
                                                       Débito/Nota de Crédito
                                                       De informar fecha de Emisión del
                                                       comprobante asociado y el punto de
                                                       venta del comprobante asociado es
<FECAEDetRequest><CbtesAsoc><CbteFch>        10212
                                                       Controlador Fiscal o FactuWeb, la
                                                       fecha no puede ser posterior al día
                                                       de hoy.
                                                       Si se informan deben tener el
<FECAEDetRequest><CbtesAsoc><CbteFch>        10213
                                                       siguiente formato yyyymmdd.
                                                       Si el tipo de comprobante que está
<FeCabReq><CbteTipo>/                                  autorizando es MiPyMEs (FCE),
                                             10214     informa opcionales, el tipo de dato
<Opcionales><Id><Valor>                                correcto para el código 27 es un
                                                       alfanumérico de 3 caracteres.
<FeCabReq><CbteTipo>/                                  Si el tipo de comprobante que está
                                             10215     autorizando es MiPyMEs (FCE),
<Opcionales><Id><Valor>
                                                       informa opcionales y el código es 27,

---

<!-- page 68 -->

                                                  Código
                  Campo / Grupo                                  Descripción de la validación
                                                  de error
                                                             los valores posibles son:

                                                             SCA = "TRANSFERENCIA AL SISTEMA
                                                             DE CIRCULACION ABIERTA"

                                                             ADC = "AGENTE DE DEPOSITO
                                                             COLECTIVO"
                                                             Si el tipo de comprobante que está
                                                             autorizando es Factura del tipo
<FeCabReq><CbteTipo>/                                        MiPyMEs (201, 206, 211), es
                                                   10216
<Opcionales><Id><Valor>                                      obligatorio informar <Opcionales>
                                                             con id = 27. Los valores posibles son
                                                             SCA o ADC.
<FECAEDetRequest><Actividades><Actividad>                    Si envía estructura de Actividades,
                                                   10218
                                                             Actividad es obligatorio enviarlo.
                                                             Si envía estructura de Actividades,
<FECAEDetRequest><Actividades><Actividad><Id>      10219     Actividad es obligatorio enviarlo y no
                                                             debe estar vacío.
                                                             El identificador de actividad
                                                             informado tiene que ser una de las
<FECAEDetRequest><Actividades><Actividad><Id>      10220
                                                             actividades habilitadas. Consultar
                                                             método FEParamGetActividades.
                                                             De enviarse el tag Actividades, las
<FECAEDetRequest><Actividades><Actividad><Id>      10221
                                                             actividades no deben repetirse.
                                                             De enviarse actividades, las mismas
                                                             no deben corresponder a distintos
                                                             grupos según RG. Es decir, si informa
<FECAEDetRequest><Actividades><Actividad><Id>      10222
                                                             actividades Cárnicas, no pueden
                                                             estar combinadas con actividades
                                                             Harineras, de Tabaco, etc.
                                                             De enviarse actividades, las mismas
                                                             deben encontrarse activas para el
<FECAEDetRequest><Actividades><Actividad><Id>      10223
                                                             emisor del comprobante. Ver
                                                             método FEParamGetActividades.
                                                             De enviarse actividades
                                                             pertenecientes al grupo de
<FECAEDetRequest><Actividades><Actividad><Id> /              actividades Cárnicas, las mismas
                                                   10224
<Concepto>                                                   deben enviarse con comprobantes
                                                             con Concepto del tipo Producto o
                                                             Productos y Servicios.
<FECAEDetRequest><Actividades><Actividad><Id>                Si las actividades informadas
                                                   10225     corresponden a actividades Cárnicas,
/<CbtesAsoc><CbteAsoc><Tipo>
                                                             informar remito asociado 995 -

---

<!-- page 69 -->

                                                Código
                  Campo / Grupo                                Descripción de la validación
                                                de error
                                                           Remito Electrónico Cárnico.
                                                           Si las actividades informadas
                                                           corresponden a actividades Harinas,
                                                           informar remito asociado 993 -
<FECAEDetRequest><Actividades><Actividad><Id>
                                                 10226     Remito Electrónico Harinero -
/<CbtesAsoc><CbteAsoc><Tipo>                               Automotor o

                                                           994 - Remito Electrónico Harinero -
                                                           Ferroviario.
                                                           Si las actividades informadas
<FECAEDetRequest><Actividades><Actividad><Id>              corresponden a actividades Tabaco
                                                 10227     en Hebras, informar remito asociado
/<CbtesAsoc><CbteAsoc><Tipo>                               88 - Remito Electrónico de Tabaco
                                                           Acondicionado.

<FECAEDetRequest><Actividades><Actividad><Id>              Si informa remito 995 - Remito
                                                 10228     Electrónico Cárnico, es obligatorio
/<CbtesAsoc><CbteAsoc><Tipo>                               informar una actividad Cárnica.
                                                           Si informa remito 993 - Remito
                                                           Electrónico Harinero - Automotor o
<FECAEDetRequest><Actividades><Actividad><Id>
                                                 10229     994 - Remito Electrónico Harinero –
/<CbtesAsoc><CbteAsoc><Tipo>
                                                           Ferroviario, es obligatorio informar
                                                           una actividad Harinera.
                                                           Si informa remito 88 - Remito
                                                           Electrónico de Tabaco
<FECAEDetRequest><Actividades><Actividad><Id>              Acondicionado., es obligatorio
                                                 10230
/<CbtesAsoc><CbteAsoc><Tipo>                               informar una actividad
                                                           correspondiente a Tabaco
                                                           Acondicionado.

<FECAEDetRequest><Actividades><Actividad><Id>              Si informa actividades indicadas en
                                                 10231     la RG, es obligatorio informar
/<CbtesAsoc><CbteAsoc                                      comprobantes asociados.
                                                           Si informa comprobantes asociados,
<CbteAsoc><Tipo> / <CbteAsoc><PtoVta> /                    y sus códigos corresponden a 91, 88,
<CbteAsoc><Nro>                                            988, 990, 991, 993, 994, 995, 996,
                                                 10232
                                                           997, los mismos no deben
                                                           encontrarse asociado a otro
                                                           comprobante.
                                                           Si informa el campo CanMisMonExt,
<FECAEDetRequest> / <CanMisMonExt>               10239     los valores posibles son S o N y no
                                                           debe quedar vacio.

<FECAEDetRequest> / <CanMisMonExt>               10240     Si informa el campo MonCotiz, el
                                                           mismo no podra superar en 1 a la

---

<!-- page 70 -->

                                               Código
                  Campo / Grupo                               Descripción de la validación
                                               de error
                                                          cotizacion oficial. Ver Metodo
                                                          FEParamGetCotizacion.
                                                          Si informa MonId = PES, el campo
<FECAEDetRequest> / <CanMisMonExt>              10241     CanMisMonExt no debe informarse
                                                          o informarse con el valor N.
                                                          El campo de identificación de la
                                                          Condición de IVA del receptor no es
<FECAEDetRequest> / <CondicionIVAReceptorId>    10242     un valor permitido. Para mayor
                                                          detalle consular el método
                                                          FEParamGetCondicionIvaReceptor.
                                                          El campo de identificación de
                                                          Condición de IVA del receptor no es
                                                          valido para la clase de comprobante
<FECAEDetRequest> / <CondicionIVAReceptorId>    10243
                                                          informado. Para mas detalle
                                                          consultar el Método:
                                                          FEParamGetCondicionIvaReceptor
                                                          Campo Condición Frente al IVA del
                                                          receptor es obligatorio conforme a
                                                          lo reglamentado por la Resolución
<FECAEDetRequest> / <CondicionIVAReceptorId>    10246
                                                          General N° 5616. Para mas
                                                          información consular método
                                                          FEParamGetCondicionIvaReceptor.
                                                          La CUIT receptora informada está
                                                          inactiva o es inválida. Esta validación
<FECAEDetRequest> / <DocNro>                    10247     es excluyente salvo si el tipo de
                                                          comprobante informado es Nota de
                                                          Crédito.
                                                          La CUIT receptora se encuentra
                                                          limitada por haber sido
                                                          caracterizada como sujeto no
<FECAEDetRequest> / <DocNro>                    10248     confiable en materia de Seguridad
                                                          Social. Esta validación es excluyente
                                                          salvo si el tipo de comprobante
                                                          informado es Nota de Crédito.
                                                          Por las Condiciones de la CUIT
                                                          Emisora, No corresponde realizar el
                                                          Comprobante. Las entidades
<Cuit> / <FeCabReq><CbteTipo>                   10251
                                                          financieras no pueden emitir
                                                          comprobantes del tipo MiPyMEs
                                                          (FCE).
                                                          Por las condiciones de la CUIT
<CbteTipo> / <DocTipo> / <DocNro>               10270     emisora, no corresponde la
                                                          utilización del tipo de documento

---

<!-- page 71 -->

                                                      Código
                    Campo / Grupo                                     Descripción de la validación
                                                      de error
                                                                  ( DocTipo) = 31. El mismo solo esta
                                                                  destinado a entidades financieras.
                                                                  El campo DocNro es invalido. Si
                                                                  informa DocTipo = 31, el numero de
 <CbteTipo> / <DocTipo> / <DocNro>                     10271
                                                                  documento debe ser numérico hasta
                                                                  4 dígitos

                                                                  Campo Condición IVA receptor no
                                                                  permitido. Para entidades
                                                                  financieras, si selecciona
 <CbteTipo> / <DocTipo> / <CondicionIVAReceptorId>     10272      TipoDoc=31, el campo Condición
                                                                  Frente al IVA del Receptor debe
                                                                  completarse con el valor = 15 (IVA
                                                                  No Alcanzado)




Validaciones No Excluyentes



                    Campo / Grupo                    Código
                                                       de            Descripción de la validación
                                                     Observ.
                                                                 El campo DocNro para comprobantes
                                                                 Tipo “A” y “A con leyenda operación
                                                     10017       sujeta a retención” deberá ser un
 <CbteTipo> / <DocNro>                                           valor registrado en el padrón de
                                                                 ARCA, en condición activa.
 <CbteAsoc><Tipo> / <CbteAsoc><PtoVta> /                         Si el punto de venta del comprobante
 <CbteAsoc><Nro>                                                 asociado (campo <PtoVta> de
                                                                 <CbtesAsoc>) es electrónico, el
                                                     10041       número de comprobante debe obrar
                                                                 en las bases del organismo para el
                                                                 punto de venta y tipo de
                                                                 comprobante informado.
 DocTipo / DocNro                                                Para comprobantes Clase “A” y “A con
                                                                 leyenda operación sujeta a retención”
                                                                 el receptor del comprobante
                                                                 informado en <DocTipo> y <DocNro>
                                                     10063
                                                                 debe corresponder a un
                                                                 contribuyente activo en el Impuesto
                                                                 al Valor Agregado o Responsable
                                                                 Monotributo.
 <Auth><Cuit>/                                       10188       Si el tipo de comprobante que está

---

<!-- page 72 -->

                  Campo / Grupo               Código
                                                de           Descripción de la validación
                                              Observ.
                                                        autorizando es 1 - Factura A o 4 -
                                                        Recibo A o 6 - Factura B o 9 - Recibo B
<DocTipo>/
                                                        o 11 - Factura C o 15 - Recibo C, por la
<DocNro>/                                               categorización de las cuits emisora y
                                                        receptora, se deberia realizar una
                                                        factura de crédito electrónica.
<FECAEDetRequest><Tributos><Id>/                        Si en la estructura Tributos informa
                                                        percepciones,
<FECAEDetRequest><PeriodoAsoc><FchDesde>/
                                              10209     <PeriodoAsoc>.<FchDesde> y
<FECAEDetRequest><PeriodoAsoc><FchHasta>                <PeriodoAsoc>.<FchHasta> deben
                                                        corresponder al mismo Mes/Anio
<CbteTipo> / <DocNro>                                   Para comprobantes Clase “A” y “A con
                                                        leyenda operación sujeta a
                                                        retención”, donde el receptor del
                                                        comprobante informado en
                                                        <DocTipo> y <DocNro> se encuentra
                                                        activo en el Impuesto Responsable
                                              10217
                                                        Monotributo, “El crédito fiscal
                                                        discriminado en el presente
                                                        comprobante solo podrá ser
                                                        computado a efectos del
                                                        Procedimiento permanente de
                                                        transición al Régimen General.”
<CbteTipo> / <DocNro>                                   Para comprobantes Clase “A” y “A con
                                                        leyenda operación sujeta a
                                                        retención”, se ha detectado que esta
                                                        pendiente de presentación el
                                                        formulario de habilitación de
                                                        comprobantes o su fecha de
                                              10234     presentación es anterior a la fecha de
                                                        alta en IVA. Para el caso que el
                                                        comprobante no sea una Nota de
                                                        Crédito, se debe proceder a anular la
                                                        operación clase “A” o “A con leyenda
                                                        operación sujeta a retención” emitida,
                                                        mediante una Nota de Crédito.
<CbteTipo> / <DocNro> / <FECAEDetRequest> /             El monto total del comprobante
ImpTotal                                                emitido, excede el límite establecido
                                                        para la categoría máxima de
                                              10235     Monotributo. Por tal motivo,
                                                        quedarías excluido automáticamente
                                                        teniendo que solicitar el alta de los
                                                        tributos (impositivos y de los recursos
                                                        de la seguridad social) en el régimen

---

<!-- page 73 -->

                     Campo / Grupo                    Código
                                                        de           Descripción de la validación
                                                      Observ.
                                                                general de acuerdo con tu actividad.
 <CbteTipo> / <DocNro> / <FECAEDetRequest> /                    El monto del comprobante emitido,
 ImpTotal                                                       excede el límite establecido para su
                                                       10236    categoría de Monotributo. Tenelo en
                                                                cuenta para la próxima
                                                                recategorización.
 <FECAEDetRequest> / ImpTotal / <CbteAsoc>                      El importe de la nota de crédito
                                                                supera el monto del comprobante
                                                                asociado que estás ajustando. Verificá
                                                       10237    los montos ingresados y de tratarse
                                                                de un error, tenés que efectuar el
                                                                ajuste o anulación de la operación
                                                                según corresponda.
 <FECAEDetRequest> / <DocNro>                          10238    La CUIT receptora ingresada no existe.
 <FECAEDetRequest> / <CondicionIVAReceptorId>                   El campo Condición Frente al IVA del
                                                                receptor resultará obligatorio
                                                                conforme lo reglamentado por la
                                                       10245
                                                                Resolución General N° 5616. Para mas
                                                                información consular método
                                                                FEParamGetCondicionIvaReceptor.
 <FECAEDetRequest> / <DocNro>                                   El número de documento informado
                                                                para el sujeto receptor corresponde a
                                                       10249
                                                                un sujeto fallecido, sin sucesión
                                                                indivisa registrada.



Operatoria ante errores

Para la operatoria del método FECAESolicitar se describe la metodología sugerida
ante rechazos / errores de los requerimiento con múltiples comprobantes.

Suponiendo que se envían 100 comprobantes por request y el mismo es de Factu-
ras A, punto de venta 1 y los comprobantes son del 51 al 150, se nos plantean 3 si-
tuaciones.

Aprobación total: donde, cada uno de los 100 comprobantes fue aprobado

Rechazo total: se puede dar por dos causas, una por problemas del emisor, y otra
por el rechazo del primer comprobante enviado en el bloque de comprobantes del de-
talle. En el primer caso el response contendrá en el tag Errors todas las causas invo-
lucradas; en el segundo caso se incluirá el tag Obs con el motivo de rechazo u ob -
servación de los comprobantes.

---

<!-- page 74 -->

Rechazo parcial: se da cuando alguno de los comprobantes incluidos en el request es
rechazado. A modo de ejemplo y con los parámetros antes descriptos, se aprueban
los comprobantes del 51 al 100, 101 saldrá rechazado y del 102 al 150 saldrá como
no procesado; esto se debe a que como debe existir correlatividad numérica y fecha,
ante una inconsistencia los comprobantes subsiguientes también se rechazaran. Si se
diese este caso, y para proseguir con la autorización de comprobantes se deberá sub-
sanar los errores del 102 y así enviar un nuevo request.

Operatoria con errores de comunicación:

En el diseño del WsfeV1 se ha previsto que –dada la complejidad actual de las comu-
nicaciones- pueden ocurrir interrupciones en la comunicación entre el cliente y el Ws-
feV1 básicamente, el problema podría resumirse al siguiente escenario: el cliente en-
vía una solicitud de CAE al WsfeV1 y se queda esperando una respuesta que no llega,
hasta que transcurrido algún tiempo, se produce una condición de time-out.

En ese caso, el usuario no sabrá si la solicitud le llegó al WsfeV1, este asignó el CAE y
la falla de comunicación se produjo durante el retorno de la información, o bien si la fa-
lla ocurrió durante el envío de la solicitud y simplemente WsfeV1 nunca la recibió.

En el segundo caso, con simplemente enviar la misma solicitud todo quedaría resuelto,
pero en el primer caso, si el cliente envía la misma nueva solicitud de CAE para la mis-
ma factura, WsfeV1 devolvería un error de consecutividad puesto que en la base de
datos de arca esa factura ya figura como emitida.

Para estos casos, se utiliza el método FECompConsultar, que dado el tipo de com-
probante, punto de venta y numero de comprobante, retorna toda la información en-
viada en el método de autorización (FECAESolicitar) más el CAE, fecha de venci-
miento del mismo. El WsfeV1 también ofrece mecanismo para la consulta del último
comprobante autorizado (FECompUltimoAutorizado).
Ejemplos
Ejemplo 1 - Factura A con diferentes Alícuotas de IVA y Tributos sin errores

Esquema de factura


    FEDetRequest


      Emisor                                    Tipo Factura A         Pto Vta / Nro 0012-00000001
                                                                       Fecha : 03 – Sep -2010
      Sr Cliente (destinatario)

                                   $ neto     % IVA     $ IVA     $ totales
      item1                           100,00      21,0%     21,00         121
      item2                             50,00     10,5%      5,25       52,25

      <Tributos>
      Tributos                        Base         %         Importe
      Base imponible                   150,00          5,2       7,8

---

<!-- page 75 -->

     Totales               $ 150,00         $ 26,25   $ 7,80      $ 184,05
                           <ImpNeto>       <ImpIVA>   <ImpTrib>   <ImpTotal>


     Moneda                   PES
     Tipo de cambio            1




REQUEST


<soapenv:Envelope
xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
xmlns:ar="http://ar.gov.afip.dif.FEV1/">
   <soapenv:Header/>
   <soapenv:Body>
       <ar:FECAESolicitar>
        <!--Optional:-->
         <ar:Auth>
            <ar:Token>PD94…..</ar:Token>
            <ar:Sign>tYft0….....</ar:Sign>
            <ar:Cuit>33693450239</ar:Cuit>
         </ar:Auth>
         <ar:FeCAEReq>
            <ar:FeCabReq>
               <ar:CantReg>1</ar:CantReg>
               <ar:PtoVta>12</ar:PtoVta>
               <ar:CbteTipo>1</ar:CbteTipo>  FACTURA A
            </ar:FeCabReq>
            <ar:FeDetReq>
             <ar:FECAEDetRequest>
                   <ar:Concepto>1</ar:Concepto>  Productos
                   <ar:DocTipo>80</ar:DocTipo>  CUIT
                   <ar:DocNro>20111111112</ar:DocNro>
                   <ar:CbteDesde>1</ar:CbteDesde>
                   <ar:CbteHasta>1</ar:CbteHasta>
                   <ar:CbteFch>20100903</ar:CbteFch>
                   <ar:ImpTotal>184.05</ar:ImpTotal>
                   <ar:ImpTotConc>0</ar:ImpTotConc>
                   <ar:ImpNeto>150</ar:ImpNeto>
                   <ar:ImpOpEx>0</ar:ImpOpEx>
                   <ar:ImpTrib>7.8</ar:ImpTrib>
                   <ar:ImpIVA>26.25</ar:ImpIVA>
                   <ar:FchServDesde></ar:FchServDesde>
                   <ar:FchServHasta></ar:FchServHasta>
                   <ar:FchVtoPago></ar:FchVtoPago>
                   <ar:MonId>PES</ar:MonId>
                   <ar:MonCotiz>1</ar:MonCotiz>
                   <ar:CondicionIVAReceptorId>1</ar:CondicionIVARecep-
torId>
                   <ar:Tributos>
                      <ar:Tributo>
                         <ar:Id>99</ar:Id>
                         <ar:Desc>Impuesto Municipal Matanza</ar:Desc>
                         <ar:BaseImp>150</ar:BaseImp>
                         <ar:Alic>5.2</ar:Alic>

---

<!-- page 76 -->

                         <ar:Importe>7.8</ar:Importe>
                      </ar:Tributo>
                   </ar:Tributos>
                   <ar:Iva>
                      <ar:AlicIva>
                         <ar:Id>5</ar:Id>        21%
                         <ar:BaseImp>100</ar:BaseImp>
                         <ar:Importe>21</ar:Importe>
                      </ar:AlicIva>
                      <ar:AlicIva>
                         <ar:Id>4</ar:Id>        10.5%
                         <ar:BaseImp>50</ar:BaseImp>
                         <ar:Importe>5.25</ar:Importe>
                      </ar:AlicIva>
                   </ar:Iva>
               </ar:FECAEDetRequest>
            </ar:FeDetReq>
         </ar:FeCAEReq>
      </ar:FECAESolicitar>
   </soapenv:Body>
</soapenv:Envelope>

RESPONSE


<soap:Envelope xmlns:soap=”http://www.w3.org/2003/05/soap-envelope”
xmlns:ar=”http://ar.gov.afip.dif.fev1/”>
   <soap:Header/>
   <soap:Body>
      <FECAESolicitarResponse>
          <FECAESolicitarResult>
             <FeCabResp>
                <PtoVta>12</PtoVta>
                <CbteTipo>1</CbteTipo>  FACTURA A
                <FchProceso>20100902</FchProceso>
                <CantReg>1</CantReg>
                <Resultado>A</Resultado>  A=APROBADO, R=RECHAZADO,
P=PARCIAL
                <Reproceso>N</Reproceso>
             </FeCabResp>
             <FeDetResp>
                <FECAEDetResponse>
                   <Concepto>1</Concepto>
                   <DocTipo>80</DocTipo>        CUIT
                   <DocNro>20111111112</DocNro>
                   <CbteDesde>1</CbteDesde>
                   <CbteHasta>1</CbteHasta>
                   <CbteFch>20100903</CbteFch>
                   <Resultado>A</Resultado>
                   <CAE>41124578989845</CAE>
                   <CAEFchVto>20100913</CAEFchVto>
                </FECAEDetResponse>
             </FeDetResp>
          </FECAESolicitarResult>
      </FECAESolicitarResponse>
   </soap:Body>
</soap:Envelope>

---

<!-- page 77 -->

Ejemplo 2 - Envío con 2 Facturas A con errores parciales (a nivel FEDetRequest).


REQUEST


<soapenv:Envelope
xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
xmlns:ar="http://ar.gov.afip.dif.FEV1/">
   <soapenv:Header/>
   <soapenv:Body>
       <ar:FECAESolicitar>
         <!--Optional:-->
          <ar:Auth>
             <ar:Token>PD94…..</ar:Token>
             <ar:Sign>tYft0….....</ar:Sign>
             <ar:Cuit>33693450239</ar:Cuit>
          </ar:Auth>
          <ar:FeCAEReq>
             <ar:FeCabReq>
                <ar:CantReg>2</ar:CantReg>
                <ar:PtoVta>12</ar:PtoVta>
                <ar:CbteTipo>1</ar:CbteTipo>  FACTURA A
             </ar:FeCabReq>
             <ar:FeDetReq>
                <ar:FECAEDetRequest>
                    <ar:Concepto>1</ar:Concepto>  Productos
                    <ar:DocTipo>80</ar:DocTipo>  CUIT
                    <ar:DocNro>20111111112</ar:DocNro>
                    <ar:CbteDesde>2</ar:CbteDesde>
                    <ar:CbteHasta>2</ar:CbteHasta>
                    <ar:CbteFch>20100903</ar:CbteFch>
                    <ar:ImpTotal>184.05</ar:ImpTotal>
                    <ar:ImpTotConc>0</ar:ImpTotConc>
                    <ar:ImpNeto>150</ar:ImpNeto>
                    <ar:ImpOpEx>0</ar:ImpOpEx>
                    <ar:ImpTrib>7.8</ar:ImpTrib>
                    <ar:ImpIVA>26.25</ar:ImpIVA>
                    <ar:FchServDesde></ar:FchServDesde>
                    <ar:FchServHasta></ar:FchServHasta>
                    <ar:FchVtoPago></ar:FchVtoPago>
                    <ar:MonId>PES</ar:MonId>
                    <ar:MonCotiz>1</ar:MonCotiz>
                    <ar:CondicionIVAReceptorId>1</ar:CondicionIVARecep-
torId>
                    <ar:Tributos>
                       <ar:Tributo>
                          <ar:Id>99</ar:Id>
                          <ar:Desc>Impuesto Municipal Matanza</ar:Desc>
                          <ar:BaseImp>150</ar:BaseImp>
                          <ar:Alic>5.2</ar:Alic>
                          <ar:Importe>7.8</ar:Importe>
                       </ar:Tributo>
                    </ar:Tributos>
                    <ar:Iva>
                       <ar:AlicIva>
                          <ar:Id>5</ar:Id>       21%
                          <ar:BaseImp>100</ar:BaseImp>

---

<!-- page 78 -->

                        <ar:Importe>21</ar:Importe>
                     </ar:AlicIva>
                     <ar:AlicIva>
                        <ar:Id>4</ar:Id>       10.5%
                        <ar:BaseImp>50</ar:BaseImp>
                        <ar:Importe>5.25</ar:Importe>
                    </ar:AlicIva>
               </ar:Iva>
               </ar:FECAEDetRequest>
               <ar:FECAEDetRequest>
                <ar:Concepto>1</ar:Concepto>  Productos
                  <ar:DocTipo>80</ar:DocTipo>    CUIT
                  <ar:DocNro>10222222222</ar:DocNro>  no existente en
Padrón arca
                  <ar:CbteDesde>4</ar:CbteDesde>
                  <ar:CbteHasta>4</ar:CbteHasta>
                  <ar:CbteFch>20100901</ar:CbteFch>
                  <ar:ImpTotal>184.05</ar:ImpTotal>
                  <ar:ImpTotConc>0</ar:ImpTotConc>
                  <ar:ImpNeto>150</ar:ImpNeto>
                  <ar:ImpOpEx>0</ar:ImpOpEx>
                  <ar:ImpTrib>7.8</ar:ImpTrib>
                  <ar:ImpIVA>26.25</ar:ImpIVA>
                  <ar:FchServDesde></ar:FchServDesde>
                  <ar:FchServHasta></ar:FchServHasta>
                  <ar:FchVtoPago></ar:FchVtoPago>
                  <ar:MonId>PES</ar:MonId>
                  <ar:MonCotiz>1</ar:MonCotiz>
                  <ar:CondicionIVAReceptorId>1</ar:CondicionIVARecep-
torId>
                   <ar:Tributos>
                      <ar:Tributo>
                         <ar:Id>99</ar:Id>
                         <ar:Desc>Impuesto Municipal Matanza</ar:Desc>
                         <ar:BaseImp>150</ar:BaseImp>
                         <ar:Alic>5.2</ar:Alic>
                         <ar:Importe>7.8</ar:Importe>
                      </ar:Tributo>
                   </ar:Tributos>
                   <ar:Iva>
                      <ar:AlicIva>
                         <ar:Id>5</ar:Id>       21%
                         <ar:BaseImp>100</ar:BaseImp>
                         <ar:Importe>21</ar:Importe>
                      </ar:AlicIva>
                      <ar:AlicIva>
                         <ar:Id>4</ar:Id>       10.5%
                         <ar:BaseImp>50</ar:BaseImp>
                         <ar:Importe>5.25</ar:Importe>
                      </ar:AlicIva>
                   </ar:Iva>
               </ar:FECAEDetRequest>
               </ar:FeDetReq>
         </ar:FeCAEReq>
      </ar:FECAESolicitar>
   </soapenv:Body>
</soapenv:Envelope>

---

<!-- page 79 -->

RESPONSE


<soap:Envelope xmlns:soap=”http://www.w3.org/2003/05/soap-envelope”
xmlns:ar=”http://ar.gov.afip.dif.fev1/”>
   <soap:Header/>
   <soap:Body>
      <FECAESolicitarResponse>
          <FECAESolicitarResult>
             <FeCabResp>
                <CantReg>2</CantReg>
                <PtoVta>12</PtoVta>
                <CbteTipo>1</CbteTipo>  FACTURA A
                <FchProceso>20100902</FchProceso>
                <Resultado>P</Resultado>  A=APROBADO, R=RECHAZADO,
P=PARCIAL
                <Reproceso>N</Reproceso>
             </FeCabResp>
             <FeDetResp>
                <FECAEDetResponse>
                   <Concepto>1</Concepto>
                   <DocTipo>80</DocTipo>         CUIT
                   <DocNro>20111111112</DocNro>
                   <CbteDesde>2</CbteDesde>
                   <CbteHasta>2</CbteHasta>
                   <CbteFch>20100903</CbteFch>
                   <Resultado>A</Resultado>
                   <CAE>41124599989845</CAE>
                   <CAEFchVto>20100913</CAEFchVto>
                </FECAEDetResponse>
                <FECAEDetResponse>
                   <Concepto>1</Concepto>
                   <DocTipo>80</DocTipo>         CUIT
                   <DocNro>10222222222</DocNro>
                   <CbteDesde>4</CbteDesde>
                   <CbteHasta>4</CbteHasta>
                   <CbteFch>20100901</CbteFch>
                   <Resultado>R</Resultado>
                   <CAE></CAE>                     Sin CAE por Rechazo
                   <CAEFchVto></CAEFchVto>
                   <Observaciones>
                      <Obs>
                          <Code>10030</Code>
                          <Msg>Cuit 10222222222 no registrada en padrón
arca</Msg>
                      </Obs>
                      <Obs>
                          <Code>10016</Code>
                          <Msg>comp. 4 no coincide con el próximo a au-
torizar</Msg>
                      </Obs>
                   </Observaciones>
                </FECAEDetResponse>
             </FeDetResp>
          </FECAESolicitarResult>
      </FECAESolicitarResponse>
   </soap:Body>

---

<!-- page 80 -->

</soap:Envelope>




Ejemplo 3 - Envio con 1 Facturas A con errores generales (a nivel de FeCAEReq).


REQUEST

<soapenv:Envelope
xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
xmlns:ar="http://ar.gov.afip.dif.FEV1/">
   <soapenv:Header/>
   <soapenv:Body>
       <ar:FECAESolicitar>
         <!--Optional:-->
          <ar:Auth>
             <ar:Token>PD94…..</ar:Token>
             <ar:Sign>tYft0….....</ar:Sign>
             <ar:Cuit>33693450239</ar:Cuit>
          </ar:Auth>
          <ar:FeCAEReq>
             <ar:FeCabReq>
                <ar:CantReg>2</ar:CantReg>
                <ar:PtoVta>15</ar:PtoVta>
                <ar:CbteTipo>1</ar:CbteTipo>  FACTURA A
             </ar:FeCabReq>
             <ar:FeDetReq>
                 <ar:FECAEDetRequest>
                <ar:Concepto>1</ar:Concepto>  Productos
                    <ar:DocTipo>80</ar:DocTipo>  CUIT
                    <ar:DocNro>20111111112</ar:DocNro>
                    <ar:CbteDesde>1</ar:CbteDesde>
                    <ar:CbteHasta>1</ar:CbteHasta>
                    <ar:CbteFch>20100903</ar:CbteFch>
                    <ar:ImpTotal>184.05</ar:ImpTotal>
                    <ar:ImpTotConc>0</ar:ImpTotConc>
                    <ar:ImpNeto>150</ar:ImpNeto>
                    <ar:ImpOpEx>0</ar:ImpOpEx>
                    <ar:ImpTrib>7.8</ar:ImpTrib>
                    <ar:ImpIVA>26.25</ar:ImpIVA>
                    <ar:FchServDesde></ar:FchServDesde>
                    <ar:FchServHasta></ar:FchServHasta>
                    <ar:FchVtoPago></ar:FchVtoPago>
                    <ar:MonId>PES</ar:MonId>
                    <ar:MonCotiz>1</ar:MonCotiz>
                    <ar:CondicionIVAReceptorId>1</ar:CondicionIVARecep-
torId>
                    <ar:Tributos>
                       <ar:Tributo>
                          <ar:Id>99</ar:Id>
                          <ar:Desc>Impuesto Municipal Matanza</ar:Desc>
                          <ar:BaseImp>150</ar:BaseImp>
                          <ar:Alic>5.2</ar:Alic>
                          <ar:Importe>7.8</ar:Importe>
                       </ar:Tributo>
                    </ar:Tributos>

---

<!-- page 81 -->

                    <ar:Iva>
                       <ar:AlicIva>
                          <ar:Id>5</ar:Id>       21%
                          <ar:BaseImp>100</ar:BaseImp>
                          <ar:Importe>21</ar:Importe>
                       </ar:AlicIva>
                       <ar:AlicIva>
                          <ar:Id>4</ar:Id>       10.5%
                          <ar:BaseImp>50</ar:BaseImp>
                          <ar:Importe>5.25</ar:Importe>
                       </ar:AlicIva>
                    </ar:Iva>
                 </ar:FECAEDetRequest>
             </ar:FeDetReq>
          </ar:FeCAEReq>
       </ar:FECAESolicitar>
    </soapenv:Body>
</soapenv:Envelope>
RESPONSE


<soap:Envelope xmlns:soap=”http://www.w3.org/2003/05/soap-envelope”
xmlns:ar=”http://ar.gov.afip.dif.fev1/”>
     <soap:Header/>
     <soap:Body>
        <FECAESolicitarResponse>
            <FECAESolicitarResult>
               <FeCabResp>
                  <CantReg>2</CantReg>
                  <PtoVta>15</PtoVta>
                  <CbteTipo>1</CbteTipo>  FACTURA A
                  <FchProceso>20100902</FchProceso>
                  <Resultado>R</Resultado>  A=APROBADO, R=RECHAZADO,
P=PARCIAL
                  <Reproceso>N</Reproceso>
               </FeCabResp>
               <Errors>
                  <Err>
                     <Code>10002</Code>
                     <Msg>No coincide la cantidad de registros informadas con la cantidad real en-
viada</Msg>
                  </Err>
                  <Err>
                     <Code>1005</Code>
                     <Msg>El punto de venta no se encuentra empadrona-
do</Msg>
                  </Err>
               </Errors>
            </FECAESolicitarResult>
        </FECAESolicitarResponse>
     </soap:Body>
</soap:Envelope>


Ejemplo 4 - Envio con 1 Factura Tipo 49 – Bienes Usados para emisor RI con errores (a nivel
de FeCAEReq).

---

<!-- page 82 -->

REQUEST

<soapenv:Envelope
xmlns:soapenv=”http://schemas.xmlsoap.org/soap/envelope/”
xmlns:ar=”http://ar.gov.afip.dif.FEV1/”>
   <soapenv:Header/>
   <soapenv:Body>
       <ar:FECAESolicitar>
          <ar:Auth>
             <ar:Token>PD94…..</ar:Token>
             <ar:Sign>tYft0….....</ar:Sign>
             <ar:Cuit>23000000004</ar:Cuit>
          </ar:Auth>
          <ar:FeCAEReq>
             <ar:FeCabReq>
                <ar:CantReg>1</ar:CantReg>
                <ar:PtoVta>15</ar:PtoVta>
                <ar:CbteTipo>49</ar:CbteTipo>  BIENES USADOS
             </ar:FeCabReq>
             <ar:FeDetReq>
                <ar:FECAEDetRequest>
                    <ar:Concepto>2</ar:Concepto>  Servicios
                    <ar:DocTipo>80</ar:DocTipo>  CUIT
                    <ar:DocNro>20111111112</ar:DocNro>
                    <ar:CbteDesde>1</ar:CbteDesde>
                    <ar:CbteHasta>1</ar:CbteHasta>
                    <ar:CbteFch>20130708</ar:CbteFch>
                    <ar:ImpTotal>1605</ar:ImpTotal>
                    <ar:ImpTotConc>1000</ar:ImpTotConc>
                    <ar:ImpNeto>500</ar:ImpNeto>
                    <ar:ImpOpEx>0</ar:ImpOpEx>
                    <ar:ImpTrib>0</ar:ImpTrib>
                    <ar:ImpIVA>105</ar:ImpIVA>
                    <ar:FchServDesde>20130708</ar:FchServDesde>
                    <ar:FchServHasta>20130708</ar:FchServHasta>
                    <ar:FchVtoPago>20130708</ar:FchVtoPago>
                    <ar:MonId>PES</ar:MonId>
                    <ar:MonCotiz>1</ar:MonCotiz>
                    <ar:CondicionIVAReceptorId>1</ar:CondicionIVARecep-
torId>
                    <ar:Iva>
                       <ar:AlicIva>
                          <ar:Id>5</ar:Id>       21%
                          <ar:BaseImp>500</ar:BaseImp>
                          <ar:Importe>105</ar:Importe>
                       </ar:AlicIva>
                    </ar:Iva>
                </ar:FECAEDetRequest>
             </ar:FeDetReq>
          </ar:FeCAEReq>
       </ar:FECAESolicitar>
   </soapenv:Body>
</soapenv:Envelope>

RESPONSE

---

<!-- page 83 -->

<soap:Envelope xmlns:soap=”http://www.w3.org/2003/05/soap-envelope”
xmlns:ar=”http://ar.gov.afip.dif.FEV1/”>
   <soap:Header/>
   <soap:Body>
      <FECAESolicitarResponse>
         <FECAESolicitarResult>
            <FeCabResp>
                <Cuit>23000000004</Cuit>
                <PtoVta>15</PtoVta>
                <CbteTipo>49</CbteTipo>
                <FchProceso>20130708124213</FchProceso>
                <CantReg>1</CantReg>
                <Resultado>R</Resultado>
                <Reproceso>N</Reproceso>
            </FeCabResp>
            <FeDetResp>
                <FECAEDetResponse>
                   <Concepto>2</Concepto>
                   <DocTipo>80</DocTipo>
                   <DocNro>30000000007</DocNro>
                   <CbteDesde>1</CbteDesde>
                   <CbteHasta>1</CbteHasta>
                   <CbteFch>20130708</CbteFch>
                   <Resultado>R</Resultado>
                   <Observaciones>
                      <Obs>
                          <Code>10030</Code>
                          <Msg>Para comprobantes de Bienes Usados, Con-
cepto debe ser igual a 1 – PRODUCTOS</Msg>
                      </Obs>
                      <Obs>
                          <Code>10076</Code>
                          <Msg>Si el comprobante es CbteTipo = 49
(Bienes Usados), es obligatorio informar opcionales. Ver método FEPa-
ramGetTiposOpcional()</Msg>
                      </Obs>
                   </Observaciones>
                   <CAE/>
                   <CAEFchVto/>
                </FECAEDetResponse>
            </FeDetResp>
         </FECAESolicitarResult>
      </FECAESolicitarResponse>
   </soap:Body>
</soap:Envelope>


Ejemplo 5 - Envio con 1 Factura Tipo 49 – Bienes Usados para emisor RI.


REQUEST

<soapenv:Envelope
xmlns:soapenv=”http://schemas.xmlsoap.org/soap/envelope/”
xmlns:ar=”http://ar.gov.afip.dif.FEV1/”>
   <soapenv:Header/>
   <soapenv:Body>

---

<!-- page 84 -->

      <ar:FECAESolicitar>
          <!--Optional:-->
          <ar:Auth>
             <ar:Token>PD94…..</ar:Token>
             <ar:Sign>tYft0….....</ar:Sign>
            <ar:Cuit>23000000004</ar:Cuit>
         </ar:Auth>
            <!--Optional:-->
         <ar:FeCAEReq>
         <!--Optional:-->
            <ar:FeCabReq>
               <ar:CantReg>1</ar:CantReg>
               <ar:PtoVta>1114</ar:PtoVta>
               <ar:CbteTipo>49</ar:CbteTipo>
            </ar:FeCabReq>
             <!--Optional:-->
            <ar:FeDetReq>
                <ar:FECAEDetRequest>
                  <ar:Concepto>1</ar:Concepto>
                  <ar:DocTipo>80</ar:DocTipo>
                  <ar:DocNro>30000000007</ar:DocNro>
                  <ar:CbteDesde>6</ar:CbteDesde>
                  <ar:CbteHasta>6</ar:CbteHasta>
                  <!–Optional:
                  <ar:CbteFch>20130720</ar:CbteFch>
                  <ar:ImpTotal>1605</ar:ImpTotal>
                  <ar:ImpTotConc>1000</ar:ImpTotConc>
                  <ar:ImpNeto>500</ar:ImpNeto>
                  <ar:ImpOpEx>0</ar:ImpOpEx>
                  <ar:ImpTrib>0</ar:ImpTrib>
                  <ar:ImpIVA>105</ar:ImpIVA>
                  <ar:MonId>PES</ar:MonId>
                  <ar:MonCotiz>1</ar:MonCotiz>
                  <ar:CondicionIVAReceptorId>1</ar:CondicionIVARecep-
torId>
                     <ar:Iva>
                        <ar:AlicIva>
                           <ar:Id>5</ar:Id>
                           <ar:BaseImp>500</ar:BaseImp>
                           <ar:Importe>105</ar:Importe>
                        </ar:AlicIva>
                      </ar:Iva>
                     <ar:Opcionales>
                      <ar:Opcional>
                           <ar:Id>91</ar:Id>
                           <ar:Valor>84Nerina Soledad Estela</ar:Valor>
                        </ar:Opcional>
                        <ar:Opcional>
                           <ar:Id>93</ar:Id>
                           <ar:Valor>Libertad 3333 Torre A – CABA – Ar-
gentina</ar:Valor>
                      </ar:Opcional>
                   </ar:Opcionales>
                </ar:FECAEDetRequest>
            </ar:FeDetReq>
         </ar:FeCAEReq>
      </ar:FECAESolicitar>
   </soapenv:Body>

---

<!-- page 85 -->

</soapenv:Envelope>

RESPONSE


<soap:Envelope xmlns:soap=”http://schemas.xmlsoap.org/soap/envelope/”
xmlns:xsi=”http://www.w3.org/2001/XMLSchema-instance”
xmlns:xsd=”http://www.w3.org/2001/XMLSchema”>
   <soap:Body>
      <FECAESolicitarResponse xmlns=”http://ar.gov.afip.dif.FEV1/”>
         <FECAESolicitarResult>
            <FeCabResp>
                <Cuit>23000000004</Cuit>
                <PtoVta>1114</PtoVta>
                <CbteTipo>49</CbteTipo>
                <FchProceso>20130715114927</FchProceso>
                <CantReg>1</CantReg>
                <Resultado>A</Resultado>
                <Reproceso>N</Reproceso>
            </FeCabResp>
            <FeDetResp>
                <FECAEDetResponse>
                   <Concepto>1</Concepto>
                   <DocTipo>80</DocTipo>
                   <DocNro>30000000007</DocNro>
                   <CbteDesde>5</CbteDesde>
                   <CbteHasta>5</CbteHasta>
                   <CbteFch>20130720</CbteFch>
                   <Resultado>A</Resultado>
                   <CAE>63288001286615</CAE>
                   <CAEFchVto>20130730</CAEFchVto>
                </FECAEDetResponse>
            </FeDetResp>
         </FECAESolicitarResult>
      </FECAESolicitarResponse>
   </soap:Body>
</soap:Envelope>


Ejemplo 6 - Envio con 1 Factura Tipo 49 – Bienes Usados para emisor Monotributista.


REQUEST

<soapenv:Envelope
xmlns:soapenv=”http://schemas.xmlsoap.org/soap/envelope/”
xmlns:ar=”http://ar.gov.afip.dif.FEV1/”>
   <soapenv:Header/>
   <soapenv:Body>
      <ar:FECAESolicitar>
       <!--Optional:-->
          <ar:Auth>
            <ar:Token>PD94…..</ar:Token>
             <ar:Sign>tYft0….....</ar:Sign>
            <ar:Cuit>23000000004</ar:Cuit>
         </ar:Auth>
             <!--Optional:-->
         <ar:FeCAEReq>

---

<!-- page 86 -->

              <!--Optional:-->
         <ar:FeCabReq>
               <ar:CantReg>1</ar:CantReg>
               <ar:PtoVta>2</ar:PtoVta>
               <ar:CbteTipo>49</ar:CbteTipo>
            </ar:FeCabReq>
              <!--Optional:-->
            <ar:FeDetReq>
               <!–-Zero or more repetitions:-->
               <ar:FECAEDetRequest>
                  <ar:Concepto>1</ar:Concepto>
                  <ar:DocTipo>91</ar:DocTipo>
                  <ar:DocNro>11111111111</ar:DocNro>
                  <ar:CbteDesde>1</ar:CbteDesde>
                  <ar:CbteHasta>1</ar:CbteHasta>
                    <!--Optional:-->
                  <ar:CbteFch>20130715</ar:CbteFch>
                  <ar:ImpTotal>1500</ar:ImpTotal>
                  <ar:ImpTotConc>1000</ar:ImpTotConc>
                  <ar:ImpNeto>0</ar:ImpNeto>
                  <ar:ImpOpEx>0</ar:ImpOpEx>
                  <ar:ImpTrib>500</ar:ImpTrib>
                  <ar:ImpIVA>0</ar:ImpIVA>
                  <ar:MonId>PES</ar:MonId>
                  <ar:MonCotiz>1</ar:MonCotiz>
                  <ar:CondicionIVAReceptorId>1</ar:CondicionIVARecep-
torId>
                 <ar:Tributos>
                     <ar:Tributo>
                        <ar:Id>1</ar:Id>
                        <ar:Desc>2</ar:Desc>
                        <ar:BaseImp>1000</ar:BaseImp>
                        <ar:Alic>25</ar:Alic>
                        <ar:Importe>250</ar:Importe>
                     </ar:Tributo>
                     <ar:Tributo>
                        <ar:Id>2</ar:Id>
                        <ar:Desc>2</ar:Desc>
                        <ar:BaseImp>500</ar:BaseImp>
                        <ar:Alic>100</ar:Alic>
                        <ar:Importe>250</ar:Importe>
                     </ar:Tributo>
                  </ar:Tributos>
                  <ar:Opcionales>
                   <ar:Opcional>
                        <ar:Id>91</ar:Id>
                        <ar:Valor>Atilio Raúl Butaraco</ar:Valor>
                     </ar:Opcional>
                    <ar:Opcional>
                        <ar:Id>92</ar:Id>
                        <ar:Valor>225</ar:Valor>
                     </ar:Opcional>
                     <ar:Opcional>
                        <ar:Id>93</ar:Id>
                        <ar:Valor>Av. Benito Blanco 50 piso 3 – Cuidad
de Montevideo – Uruguay</ar:Valor>
                   </ar:Opcional>
                  </ar:Opcionales>

---

<!-- page 87 -->

                </ar:FECAEDetRequest>
            </ar:FeDetReq>
         </ar:FeCAEReq>
      </ar:FECAESolicitar>
   </soapenv:Body>
</soapenv:Envelope>

RESPONSE


<soap:Envelope xmlns:soap=”http://schemas.xmlsoap.org/soap/envelope/”
xmlns:xsi=”http://www.w3.org/2001/XMLSchema-instance”
xmlns:xsd=”http://www.w3.org/2001/XMLSchema”>
   <soap:Body>
      <FECAESolicitarResponse xmlns=”http://ar.gov.afip.dif.FEV1/”>
         <FECAESolicitarResult>
            <FeCabResp>
                <Cuit>23000000004</Cuit>
                <PtoVta>2</PtoVta>
                <CbteTipo>49</CbteTipo>
                <FchProceso>20130715130307</FchProceso>
                <CantReg>1</CantReg>
                <Resultado>A</Resultado>
                <Reproceso>N</Reproceso>
            </FeCabResp>
            <FeDetResp>
                <FECAEDetResponse>
                   <Concepto>1</Concepto>
                   <DocTipo>91</DocTipo>
                   <DocNro>11111111111</DocNro>
                   <CbteDesde>1</CbteDesde>
                   <CbteHasta>1</CbteHasta>
                   <CbteFch>20130715</CbteFch>
                   <Resultado>A</Resultado>
                   <CAE>63288001286628</CAE>
                   <CAEFchVto>20130725</CAEFchVto>
                </FECAEDetResponse>
            </FeDetResp>
         </FECAESolicitarResult>
      </FECAESolicitarResponse>
   </soap:Body>
</soap:Envelope>



Método de obtención de CAEA (FECAEASolicitar)

Esta operación permite solicitar un CAEA. El cliente envía el requerimiento, el cual es atendido
por el WS, superadas las validaciones se otorgará un CAEA y su respectivo periodo de vigencia
(fecha de validez desde y fecha de validez hasta).

Podrá ser solicitado dentro de cada quincena y hasta 5 (cinco) días corridos anteriores al
comienzo de cada quincena. Habrá dos quincenas, la primera abarca desde el primero hasta el
quince de cada mes y la segunda desde el dieciséis hasta el último día del mes.

---

<!-- page 88 -->

Dirección URL (Homologación)
Este servicio se llama desde:

https://wswhomo.afip.gov.ar/wsfev1/service.asmx?op= FECAEASolicitar

Mensaje de solicitud



  <soapenv:Envelope
  xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:ar="http://ar.gov.afip.dif.FEV1/">
     <soapenv:Header/>
     <soapenv:Body>
        <ar:FECAEASolicitar>
             <ar:Auth>
              <ar:Token>string</ar:Token>
              <ar:Sign>string</ar:Sign>
              <ar:Cuit>long</ar:Cuit>
           </ar:Auth>
           <ar:Periodo>int</ar:Periodo>
           <ar:Orden>short</ar:Orden>
        </ar:FECAEASolicitar>
     </soapenv:Body>
  </soapenv:Envelope>




        Campo                                    Detalle                        Obligatorio
                       Información de la autenticación. Contiene los datos de
Auth                                                                                 S
                       Token, Sign y Cuit
Token                  Token devuelto por el WSAA                                    S
Sign                   Sign devuelto por el WSAA                                     S
Cuit                   Cuit contribuyente (representado o Emisora)                   S


        Campo                                    Detalle                        Obligatorio
                       Información del periodo y orden del CAEA que se está
FeCAEAReq                                                                            S
                       solicitando


FeCAEAReq:
    Campo                    Tipo                          Detalle              Obligatorio
Periodo                Int (6)         Periodo del CAEA. (yyyymm)                   S
Orden                  Short (1)       Orden del CAEA dentro del periodo.
                                                                                    S
                                       Quincena 1, Quincena 2

---

<!-- page 89 -->

Mensaje de respuesta
Retorna los detalles de un CAEA autorizado.


  <?xml version=”1.0” encoding=”utf-8”?>
  <soap12:Envelope xmlns:xsi=”http://www.w3.org/2001/XMLSchema-
  instance” xmlns:xsd=”http://www.w3.org/2001/XMLSchema”
  xmlns:soap12=”http://www.w3.org/2003/05/soap-envelope”>
    <soap12:Body>
      <FECAEASolicitarResponse xmlns=”http://ar.gov.afip.dif.FEV1/”>
        <FECAEASolicitarResult>
          <ResultGet>
            <CAEA>string</CAEA>
            <Periodo>int</Periodo>
            <Orden>short</Orden>
            <FchVigDesde>string</FchVigDesde>
            <FchVigHasta>string</FchVigHasta>
            <FchTopeInf>string</FchTopeInf>
            <FchProceso>string</FchProceso>
            <Observaciones>
              <Obs>
                  <Code>int</Code>
                  <Msg>string</ Msg>
              </Obs>
            </Observaciones>
          </ResultGet>
          <Errors>
            <Err>
              <Code>int</Code>
              <Msg>string</Msg>
            </Err>
            <Err>
              <Code>int</Code>
              <Msg>string</Msg>
            </Err>
          </Errors>
          <Events>
            <Evt>
              <Code>int</Code>
              <Msg>string</Msg>
            </Evt>
            <Evt>
              <Code>int</Code>
              <Msg>string</Msg>
            </Evt>
          </Events>
        </FECAEASolicitarResult>
      </FECAEASolicitarResponse>
    </soapenv:Body>
  </soap:Envelope>



Donde:

FECAEASolicitarResult:
 Campo                 Detalle                                  Obligatorio

---

<!-- page 90 -->

 ResultGet                      Información completa del CAEA autorizado                       S
 Errors                         Información de errores detectados                             N
 Events                         Información de eventos                                        N



ResultGet: está compuesto por los siguientes campos:
    Campo           Tipo                        Detalle                                  Obligatorio
 CAEA              String (14)         Código de Autorización electrónico anticipado          N
 Periodo           Int (6)             Periodo (yyyymm)                                        S
 Orden             Short (1)           Orden. Quincena 1, quincena 2                           S
 FchVigDesde       String (8)          Fecha de vigencia de CAEA desde                        N
 FchVigHasta       String (8)          Fecha de vigencia de CAEA hasta                        N
                                       Fecha de tope para informar los
 FchTopeInf        String (c8)                                                                N
                                       comprobantes vinculados al CAEA
 FchProceso        String (14)         Fecha de proceso, formato yyyymmddhhmiss               N
 Observaciones     Array               Detalle de observaciones, del comprobante              N


Observaciones: La estructura de datos Obs muestra el detalle de observaciones para el CAEA
generado; estará compuesta por los siguientes campos:



       Campo               Tipo                             Detalle                        Obligatorio
 Code               Int (5)            Código de observación                                       S
 Msg                String (255)       Mensaje                                                     S


Validaciones y errores


Controles aplicados al elemento <FeCAEAReq>



Validaciones Excluyentes


    Campo /          Código de
                                                          Descripción de la validación
     Grupo             error
 <Cuit>                  15000         Campo CUIT: Debe encontrarse activa en el Sistema Registral.

 <Cuit>                  15001         Campo CUIT: Deberá estar registrado como Autoimpresor. Se
                                       informa que esta validación quedará fuera de vigencia a partir del

---

<!-- page 91 -->

    Campo /          Código de
                                                      Descripción de la validación
     Grupo             error
                                   01/06/2026.
                                   Campo CUIT: Deberá poseer al menos un punto de venta activo
 <Cuit>                15003
                                   correspondiente al régimen CAEA
                                   Campo Periodo: Debe tener el formato AAAAMM, donde AAAA
 <Periodo>             15004
                                   indica el año y MM el mes en números.
 <Orden>               15005       Campo Orden: Debe ser igual a 1 ó 2.
                                   Al momento de solicitar CAEA, la fecha de envío podrá ser desde
 Fecha de envío        15006       5 (cinco) días corridos anteriores al inicio de cada quincena hasta
                                   el último día de la misma quincena.
 <Periodo> /                       No debe existir un CAEA otorgado para la CUIT solicitante con
                       15008
 <Orden>                           igual periodo y orden.
 <Cuit>                15009       Campo CUIT: Registra problemas de domicilio
                                   Campo CUIT: Deberá estar inscripto en alguno de los sig.
                                   impuestos:

 <Cuit>                15010               20 - MONOTRIBUTO

                                           30 - IVA

                                           32 - IVA EXENTO
                                   Campo CUIT: Deberá tener al menos una actividad económica
 <Cuit>                15011
                                   declarada
                                   Campo CUIT: Deberá estar empadronado en el régimen de
 <Cuit>                15012
                                   emisión de comprobantes electrónicos




Validaciones No Excluyentes



     Campo / Grupo           Código de
                                                         Descripción de la validación
                              Observ.

 <Cuit>/                                 Que No adeude la presentación del Régimen por 2 periodos
                               15014     mensuales consecutivos ó 3 periodos mensuales alternados
 <Periodo> / <Orden>                     en los últimos 12 meses calendario.
                                         Campo CUIT: Registra problemas en el domicilio fiscal
 <Cuit>                        15015
                                         electrónico. No se encuentra adherido.


Ejemplo sin Observaciones:

---

<!-- page 92 -->

Request



          <soapenv:Envelope
          xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
          xmlns:ar="http://ar.gov.afip.dif.FEV1/">
             <soapenv:Header/>
             <soapenv:Body>
                <ar:FECAEASolicitar>
                   <!--Optional:-->
                   <ar:Auth>
                      <!--Optional:-->
                      <ar:Token>un string</ar:Token>
                       <ar:Sign>un string</ar:Sign>
                      <ar:Cuit>33333333333</ar:Cuit>
                   </ar:Auth>
                   <ar:Periodo>201011</ar:Periodo>
                   <ar:Orden>1</ar:Orden>
                </ar:FECAEASolicitar>
             </soapenv:Body>
          </soapenv:Envelope>


Response


          <?xml version=”1.0” encoding=”utf-8”?>
          <soap12:Envelopexmlns:xsi=”http://www.w3.org/2001/
          XMLSchema-instance”
          xmlns:xsd=”http://www.w3.org/2001/XMLSchema”
          xmlns:soap12=”http://www.w3.org/2003/05/soap-envelope”>
            <soap12:Body>
              <FECAEASolicitarResponse
          xmlns=”http://ar.gov.afip.dif.FEV1/”>
                <FECAEASolicitarResult>
                  <ResultGet>
                    <CAEA>12345678901234</CAEA>
                    <Periodo>201011</Periodo>
                    <Orden>1</Orden>
                    <FchVigDesde>20101101</FchVigDesde>
                    <FchVigHasta>20101115</FchVigHasta>
                    <FchTopeInf>20101215</FchTopeInf>
                    <FchProceso>20101028</FchProceso>
                  </ResultGet>
                </FECAEASolicitarResult>
              </FECAEASolicitarResponse>
            </soapenv:Body>
          </soap:Envelope>




Ejemplo con observaciones:

---

<!-- page 93 -->

Request



          <soapenv:Envelope
          xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
          xmlns:ar="http://ar.gov.afip.dif.FEV1/">
             <soapenv:Header/>
             <soapenv:Body>
                <ar:FECAEASolicitar>
                   <!--Optional:-->
                   <ar:Auth>
                      <!--Optional:-->
                      <ar:Token>un string</ar:Token>
                       <ar:Sign>un string</ar:Sign>
                      <ar:Cuit>33333333333</ar:Cuit>
                   </ar:Auth>
                   <ar:Periodo>201011</ar:Periodo>
                   <ar:Orden>1</ar:Orden>
                </ar:FECAEASolicitar>
             </soapenv:Body>
          </soapenv:Envelope>


Response


          <?xml version=”1.0” encoding=”utf-8”?>
          <soap12:Envelopexmlns:xsi=”http://www.w3.org/2001/
          XMLSchema-instance”
          xmlns:xsd=”http://www.w3.org/2001/XMLSchema”
          xmlns:soap12=”http://www.w3.org/2003/05/soap-envelope”>
            <soap12:Body>
              <FECAEASolicitarResponse
          xmlns=”http://ar.gov.afip.dif.FEV1/”>
                <FECAEASolicitarResult>
                  <ResultGet>
                    <CAEA>12345678901234</CAEA>
                    <Periodo>201011</Periodo>
                    <Orden>1</Orden>
                    <FchVigDesde>20101101</FchVigDesde>
                    <FchVigHasta>20101115</FchVigHasta>
                    <FchTopeInf>20101215</FchTopeInf>
                    <FchProceso>20101028</FchProceso>
                    <Observaciones>
                     <Obs>
                     <Code>15015</Code>
                     <Msg> Registra problemas en el domicilio fis-
          cal electrónico. No se encuentra adherido </Msg>
                     </Obs>
                    </Observaciones>
                  </ResultGet>
                </FECAEASolicitarResult>
              </FECAEASolicitarResponse>
            </soapenv:Body>
          </soap:Envelope>

---

<!-- page 94 -->

Método de consulta de CAEA (FECAEAConsultar)

Este método permite consultar la información correspondiente a un CAEA previamente
otorgado para un periodo/orden.


Dirección URL (Homologación)
Este servicio se llama desde:

https://wswhomo.afip.gov.ar/wsfev1/service.asmx?op=FECAEAConsultar




Mensaje de solicitud
  <soapenv:Envelope
  xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:ar="http://ar.gov.afip.dif.FEV1/">
     <soapenv:Header/>
     <soapenv:Body>
        <ar:FECAEAConsultar>
           <ar:Auth>
               <ar:Token>string</ar:Token>
              <ar:Sign>string</ar:Sign>
              <ar:Cuit>long</ar:Cuit>
           </ar:Auth>
           <ar:Periodo>int</ar:Periodo>
           <ar:Orden>short</ar:Orden>
        </ar:FECAEAConsultar>
     </soapenv:Body>
  </soapenv:Envelope>



Donde:

         Campo                                   Detalle                               Obligatorio
Auth                   Información de la autenticación. Contiene los datos de Token,
                                                                                           S
                       Sign y Cuit
Token                  Token devuelto por el WSAA                                          S
Sign                   Sign devuelto por el WSAA                                           S
Cuit                   Cuit contribuyente (representado o Emisora)                         S




       Campo            Tipo                           Detalle                         Obligatorio

---

<!-- page 95 -->

 Periodo            int (6)       Periodo del CAEA. (yyyymm)                       S
                                  Orden del CAEA dentro del periodo. Quincena 1,
 Orden              short (1)                                                      S
                                  Quincena 2




Mensaje de respuesta
Retorna los detalles de los CAEA autorizados para el periodo y orden consultado.



  <?xml version=”1.0” encoding=”utf-8”?>
  <soap12:Envelope xmlns:xsi=”http://www.w3.org/2001/XMLSchema-
  instance” xmlns:xsd=”http://www.w3.org/2001/XMLSchema”
  xmlns:soap12=”http://www.w3.org/2003/05/soap-envelope”>
    <soap12:Body>
      <FECAEAConsultarResponse xmlns=”http://ar.gov.afip.dif.FEV1/”>
        <FECAEAConsultarResult>
          <ResultGet>
            <CAEA>string</CAEA>
            <Periodo>int</Periodo>
            <Orden>short </Orden>
            <FchVigDesde>string</FchVigDesde>
            <FchVigHasta>string</FchVigHasta>
            <FchTopeInf>string</FchTopeInf>
            <FchProceso>string</FchProceso>
            <Observaciones>
              <Obs>
                  <Code>int</Code>
                  <Msg>string</ Msg>
              </Obs>
            </Observaciones>
          </ResultGet>
          <Errors>
            <Err>
              <Code>int</Code>
              <Msg>string</Msg>
            </Err>
            <Err>
              <Code>int</Code>
              <Msg>string</Msg>
            </Err>
          </Errors>
          <Events>
            <Evt>
              <Code>int</Code>
              <Msg>string</Msg>
            </Evt>
            <Evt>
              <Code>int</Code>
              <Msg>string</Msg>
            </Evt>
          </Events>
        </FECAEAConsultarResult>
      </FECAEAConsultarResponse>

---

<!-- page 96 -->

    </soapenv:Body>
  </soapenv:Envelope>



Donde:

FECAEAConsultarResult:

         Campo                                  Detalle                               Obligatorio
ResultGet             Información completa de los CAEA Autorizados.                        S
Errors                Información de errores detectados                                    N
Events                Información de eventos                                               N


ResultGet: Detalle de un CAEA válido; esta compuesto por los siguientes campos:
     Campo             Tipo                     Detalle                    Obligatorio
 CAEA                 String (14)    Código de Autorización electrónico anticipado         N
 Periodo              Int (6)        Periodo (yyyymm)                                      S
 Orden                Short (1)      Orden. Quincena 1, quincena 2                         S
 FchVigDesde          String (8)     Fecha de vigencia de CAEA desde                       N
 FchVigHasta          String (8)     Fecha de vigencia de CAEA hasta                       N
                                     Fecha de tope para informar los
 FchTopeInf           String (8)                                                           N
                                     comprobantes vinculados al CAEA
 FchProceso           String (8)     Fecha de proceso                                      N




Validaciones, acciones y errores


Controles aplicados al objeto <FECAEAConsultar>

Validaciones Excluyentes



    Campo /          Código de
                                                       Descripción de la validación
     Grupo             error
                                    El valor indicado en el campo <Periodo> es obligatorio.. Debe
 <Periodo>             15004        tener formato AAAAMM, donde AAAA indica el año y MM el mes
                                    en números.
                                    El valor indicado en el campo <Orden> es obligatorio. Valores
 <Orden>               15005
                                    permitidos 1 o 2.

---

<!-- page 97 -->

Ejemplo:



           <soapenv:Envelope
           xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
           xmlns:ar="http://ar.gov.afip.dif.FEV1/">
              <soapenv:Header/>
              <soapenv:Body>
                 <ar:FECAEAConsultar>
                    <ar:Auth>
                        <ar:Token>un string</ar:Token>
                       <ar:Sign>un string</ar:Sign>
                       <ar:Cuit>33000000007</ar:Cuit>
                    </ar:Auth>
                    <ar:Periodo>201011</ar:Periodo>
                    <ar:Orden>1</ar:Orden>
                 </ar:FECAEAConsultar>
              </soapenv:Body>
           </soapenv:Envelope>



           <?xml version=”1.0” encoding=”utf-8”?>
           <soap12:Envelope
           xmlns:xsi=”http://www.w3.org/2001/XMLSchema-instance”
           xmlns:xsd=”http://www.w3.org/2001/XMLSchema”
           xmlns:soap12=”http://www.w3.org/2003/05/soap-envelope”>
             <soap12:Body>
               <FECAEAConsultarResponse
           xmlns=”http://ar.gov.afip.dif.FEV1/”>
                 <FECAEAConsultarResult>
                   <ResultGet>
                     <CAEA>12345678901234</CAEA>
                     <Periodo>201011</Periodo>
                     <Orden>1</Orden>
                     <FchVigDesde>20101101</FchVigDesde>
                     <FchVigHasta>20101115</FchVigHasta>
                     <FchTopeInf>20101215</FchTopeInf>
                     <FchProceso>20101028</FchProceso>
                   </ResultGet>
                 </FECAEAConsultarResult>
               </FECAEAConsultarResponse>
             </soapenv:Body>
           </soap:Envelope>



Recuperador de valores referenciales de códigos de Tipos de comprobante
(FEParamGetTiposCbte)

Este método permite consultar los tipos de comprobantes habilitados en este WS.


Dirección URL (Homologación)
Este servicio se llama desde:
https://wswhomo.afip.gov.ar/wsfev1/service.asmx?op= FEParamGetTiposCbte

---

<!-- page 98 -->

Mensaje de solicitud
Recibe las credenciales de autenticación y la cuit del usuario representado.

  <soapenv:Envelope
  xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:ar="http://ar.gov.afip.dif.FEV1/">
     <soapenv:Header/>
     <soapenv:Body>
        <ar:FEParamGetTiposCbte>
         <ar:Auth>
          <ar:Token>string</ar:Token>
          <ar:Sign>string</ar:Sign>
          <ar:Cuit>long</ar:Cuit>
        </ar:Auth>
      </ar:FEParamGetTiposCbte>
    </soapenv:Body>
  </soapenv:Envelope>


Donde:

        Campo                                 Detalle                          Obligatorio
                    Información de la autenticación. Contiene los datos de
 Auth                                                                              S
                    Token, Sign , Cuit
 Token              Token devuelto por el WSAA                                     S
 Sign               Sign devuelto por el WSAA                                      S
 Cuit               Cuit contribuyente (representado o Emisora)                    S


Mensaje de respuesta
Retorna el universo de tipos de comprobante validos.

  <?xml version=”1.0” encoding=”utf-8”?>
  <soap:Envelope xmlns:xsi=”http://www.w3.org/2001/XMLSchema-
  instance” xmlns:xsd=”http://www.w3.org/2001/XMLSchema”
  xmlns:soap=”http://schemas.xmlsoap.org/soap/envelope/”>
    <soap:Body>
      <FEParamGetTiposCbteResponse
  xmlns=”http://ar.gov.afip.dif.fev1/”>
        <FEParamGetTiposCbteResult>
          <ResultGet>
            <CbteTipo>
              <Id>int</Id>
              <Desc>string</Desc>
              <FchDesde>string</FchDesde>
              <FchHasta>string</FchHasta>
            </CbteTipo>
            <CbteTipo>
              <Id>int</Id>
              <Desc>string</Desc>
              <FchDesde>string</FchDesde>

---

<!-- page 99 -->

                 <FchHasta>string</FchHasta>
               </CbteTipo>
             </ResultGet>
             <Errors>
               <Err>
                 <Code>int</Code>
                 <Msg>string</Msg>
               </Err>
               <Err>
                 <Code>int</Code>
                 <Msg>string</Msg>
               </Err>
             </Errors>
             <Events>
               <Evt>
                 <Code>int</Code>
                 <Msg>string</Msg>
               </Evt>
               <Evt>
                 <Code>int</Code>
                 <Msg>string</Msg>
               </Evt>
             </Events>
           </FEParamGetTiposCbteResult>
         </FEParamGetTiposCbteResponse>
       </soap:Body>
     </soap:Envelope>



Donde:

FEParamGetTiposCbteResult:

         Campo                                  Detalle                             Obligatorio
                       Información de los diferentes tipos de comprobantes
ResultGet                                                                               N
                       permitidos.
Errors                 Información de errores detectados                                N
Events                 Información de eventos                                           N


ResultGet: Detalle de los tipos de comprobantes; esta compuesto por los siguientes campos:

       Campo           Tipo                           Detalle                       Obligatorio
Id               Int (3)          Código de comprobante                                  S
Desc             String (250)     Descripción                                            S

FchDesde         String (8)       Fecha de vigencia desde                                S

FchHasta         String (8)       Fecha de vigencia hasta                               N

---

<!-- page 100 -->

Recuperador de valores referenciales de códigos de Tipos de Conceptos
(FEParamGetTiposConcepto)

Este método devuelve los tipos de conceptos posibles en este WS.


Dirección URL (Homologación)
Este servicio se llama desde:
https://wswhomo.afip.gov.ar/wsfev1/service.asmx?op=
EparamGetTiposConcepto

Mensaje de solicitud
Recibe las credenciales de autenticación y la cuit del usuario representado.

  <soapenv:Envelope
  xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:ar="http://ar.gov.afip.dif.FEV1/">
     <soapenv:Header/>
     <soapenv:Body>
        <ar:FEParamGetTiposConcepto>
             <ar:Auth>
              <ar:Token>sring</ar:Token>
              <ar:Sign>string</ar:Sign>
              <ar:Cuit>long</ar:Cuit>
           </ar:Auth>
        </ar:FEParamGetTiposConcepto>
     </soapenv:Body>
  </soapenv:Envelope>


donde:

        Campo                                 Detalle                          Obligatorio
                    Información de la autenticación. Contiene los datos de
 Auth                                                                              S
                    Token, Sign , Cuit
 Token              Token devuelto por el WSAA                                     S
 Sign               Sign devuelto por el WSAA                                      S
 Cuit               Cuit contribuyente (representado o Emisora)                    S


Mensaje de respuesta
  <?xml version=”1.0” encoding=”utf-8”?>
  <soap:Envelope xmlns:xsi=”http://www.w3.org/2001/XMLSchema-
  instance” xmlns:xsd=”http://www.w3.org/2001/XMLSchema”
  xmlns:soap=”http://schemas.xmlsoap.org/soap/envelope/”>
    <soap:Body>
      <FEParamGetTiposConceptoResponse
  xmlns=”http://ar.gov.afip.dif.fev1/”>

---

<!-- page 101 -->

        <FEParamGetTiposConceptoResult>
          <ResultGet>
            <ConceptoTipo>
              <Id>int</Id>
              <Desc>string</Desc>
              <FchDesde>string</FchDesde>
              <FchHasta>string</FchHasta>
            </ConceptoTipo>
            <ConceptoTipo>
              <Id>int</Id>
              <Desc>string</Desc>
              <FchDesde>string</FchDesde>
              <FchHasta>string</FchHasta>
            </ConceptoTipo>
          </ResultGet>
          <Errors>
            <Err>
              <Code>int</Code>
              <Msg>string</Msg>
            </Err>
            <Err>
              <Code>int</Code>
              <Msg>string</Msg>
            </Err>
          </Errors>
          <Events>
            <Evt>
              <Code>int</Code>
              <Msg>string</Msg>
            </Evt>
            <Evt>
              <Code>int</Code>
              <Msg>string</Msg>
            </Evt>
          </Events>
        </FEParamGetTiposConceptoResult>
      </FEParamGetTiposConceptoResponse>
    </soap:Body>
  </soap:Envelope>



donde:

FEParamGetTiposConceptoResult
     Campo                                      Detalle                             Obligatorio
 ResultGet           Información de los diferentes tipos de conceptos permitidos.         N
 Errors              Información de errores detectados                                    N
 Events              Información de eventos                                               N


ResultGet: Detalle de los tipos de conceptos; esta compuesto por los siguientes campos:

donde:

---

<!-- page 102 -->

        Campo                Tipo                        Detalle                   Obligatorio
 Id                    Int (2)        Código de concepto                                    S
 Desc                  String (250)   Descripción                                           S
 FchDesde              String (8)     Fecha de vigencia desde                               S
 FchHasta              String (8)     Fecha de vigencia hasta                               N



Recuperador de valores referenciales de códigos de Tipos de Documentos
(FEParamGetTiposDoc)

Este método retorna el universo de tipos de documentos disponibles en el presente WS.



Dirección URL (Homologación)
Este servicio se llama desde:
https://wswhomo.afip.gov.ar/wsfev1/service.asmx?op= FEParamGetTiposDoc

Mensaje de solicitud
Recibe las credenciales de autenticación y la cuit del usuario representado.

  <soapenv:Envelope
  xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:ar="http://ar.gov.afip.dif.FEV1/">
     <soapenv:Header/>
     <soapenv:Body>
        <ar:FEParamGetTiposDoc>
           <ar:Auth>
                <ar:Token>string</ar:Token>
                <ar:Sign>string</ar:Sign>
              <ar:Cuit>long</ar:Cuit>
           </ar:Auth>
        </ar:FEParamGetTiposDoc>
     </soapenv:Body>
  </soapenv:Envelope>


donde:

       Campo                                  Detalle                           Obligatorio
                    Información de la autenticación. Contiene los datos de
Auth                                                                                    S
                    Token, Sign , Cuit
Token               Token devuelto por el WSAA                                          S
Sign                Sign devuelto por el WSAA                                           S
Cuit                Cuit contribuyente (representado o Emisora)                         S

---

<!-- page 103 -->

Mensaje de respuesta
  <?xml version=”1.0” encoding=”utf-8”?>
  <soap:Envelope xmlns:xsi=”http://www.w3.org/2001/XMLSchema-
  instance” xmlns:xsd=”http://www.w3.org/2001/XMLSchema”
  xmlns:soap=”http://schemas.xmlsoap.org/soap/envelope/”>
    <soap:Body>
      <FEParamGetTiposDocResponse
  xmlns=”http://ar.gov.afip.dif.fev1/”>
        <FEParamGetTiposDocResult>
          <ResultGet>
            <DocTipo>
              <Id>int</Id>
              <Desc>string</Desc>
              <FchDesde>string</FchDesde>
              <FchHasta>string</FchHasta>
            </DocTipo>
            <DocTipo>
              <Id>int</Id>
              <Desc>string</Desc>
              <FchDesde>string</FchDesde>
              <FchHasta>string</FchHasta>
            </DocTipo>
          </ResultGet>
          <Errors>
            <Err>
              <Code>int</Code>
              <Msg>string</Msg>
            </Err>
            <Err>
              <Code>int</Code>
              <Msg>string</Msg>
            </Err>
          </Errors>
          <Events>
            <Evt>
              <Code>int</Code>
              <Msg>string</Msg>
            </Evt>
            <Evt>
              <Code>int</Code>
              <Msg>string</Msg>
            </Evt>
          </Events>
        </FEParamGetTiposDocResult>
      </FEParamGetTiposDocResponse>
    </soap:Body>
  </soap:Envelope>



donde:

FEParamGetTiposDocResult:

      Campo                                 Detalle                      Obligatorio
 ResultGet         Información sobre los tipos de documento aceptados.       N
 Errors            Información de errores detectados                         N

---

<!-- page 104 -->

 Events                Información de eventos                                                N


ResultGet:

      Campo                  Tipo                        Detalle                     Obligatorio
 Id                Int (2)            Código de tipo de documento                            S
 Desc              String (250)       Descripción                                            S
 FchDesde          String(8)          Fecha de vigencia desde                                S
 FchHasta          String (8)         Fecha de vigencia hasta                                N



Recuperador de valores referenciales de códigos de Tipos de Alícuotas
(FEParamGetTiposIva)

Mediante este método se obtiene la totalidad de alícuotas de IVA posibles de uso en el
presente WS, detallando código y descripción.

Dirección URL (Homologación)
Este servicio se llama desde:
https://wswhomo.afip.gov.ar/wsfev1/service.asmx?op= FEParamGetTiposIva



Mensaje de solicitud
Recibe las credenciales de autenticación y la cuit del usuario representado.

  <soapenv:Envelope
  xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:ar="http://ar.gov.afip.dif.FEV1/">
     <soapenv:Header/>
     <soapenv:Body>
        <ar:FEParamGetTiposIva>
             <ar:Auth>
              <ar:Token>string</ar:Token>
              <ar:Sign>string</ar:Sign>
              <ar:Cuit>long</ar:Cuit>
           </ar:Auth>
        </ar:FEParamGetTiposIva>
     </soapenv:Body>
  </soapenv:Envelope>


donde:
    Campo                                     Detalle                              Obligatorio
                    Información de la autenticación. Contiene los datos de
 Auth                                                                                    S
                    Token, Sign , Cuit
 Token              Token devuelto por el WSAA                                           S
 Sign               Sign devuelto por el WSAA                                            S

---

<!-- page 105 -->

 Cuit            Cuit contribuyente (representado o Emisora)    S


Mensaje de respuesta
  <?xml version=”1.0” encoding=”utf-8”?>
  <soap:Envelope xmlns:xsi=”http://www.w3.org/2001/XMLSchema-
  instance” xmlns:xsd=”http://www.w3.org/2001/XMLSchema”
  xmlns:soap=”http://schemas.xmlsoap.org/soap/envelope/”>
    <soap:Body>
      <FEParamGetTiposIvaResponse
  xmlns=”http://ar.gov.afip.dif.fev1/”>
        <FEParamGetTiposIvaResult>
          <ResultGet>
            <IvaTipo>
              <Id>string</Id>
              <Desc>string</Desc>
              <FchDesde>string</FchDesde>
              <FchHasta>string</FchHasta>
            </IvaTipo>
            <IvaTipo>
              <Id>string</Id>
              <Desc>string</Desc>
              <FchDesde>string</FchDesde>
              <FchHasta>string</FchHasta>
            </IvaTipo>
          </ResultGet>
          <Errors>
            <Err>
              <Code>int</Code>
              <Msg>string</Msg>
            </Err>
            <Err>
              <Code>int</Code>
              <Msg>string</Msg>
            </Err>
          </Errors>
          <Events>
            <Evt>
              <Code>int</Code>
              <Msg>string</Msg>
            </Evt>
            <Evt>
              <Code>int</Code>
              <Msg>string</Msg>
            </Evt>
          </Events>
        </FEParamGetTiposIvaResult>
      </FEParamGetTiposIvaResponse>
    </soap:Body>
  </soap:Envelope>



donde:

FEParamGetTiposIvaResult:

---

<!-- page 106 -->

         Campo                                    Detalle                          Obligatorio
                       Información sobre los tipos de alícuotas permitidas.
ResultGet                                                                                  N
                       Contiene los datos IvaTipo
Errors                 Información de errores detectados                                   N
Events                 Información de eventos                                              N


IvaTipo

         Campo                   Tipo                       Detalle                Obligatorio
 Id                    Int (2)             Tipo de IVA                                     S
 Desc                  String (250)        Descripción                                     S
 FchDesde              String (8)          Fecha de vigencia desde                         S
 FchHasta              String (8)          Fecha de vigencia hasta                         N



Recuperador de valores referenciales de códigos de Tipos de Monedas
(FEParamGetTiposMonedas)

Este método retorna el universo de Monedas disponibles en el presente WS, indicando id y
descripción de cada una.



Dirección URL (Homologación)
Este servicio se llama desde:
https://wswhomo.afip.gov.ar/wsfev1/service.asmx?op=
FEParamGetTiposMonedas




Mensaje de solicitud
Recibe las credenciales de autenticación y la cuit del usuario representado.

  <soapenv:Envelope
  xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:ar="http://ar.gov.afip.dif.FEV1/">
     <soapenv:Header/>
     <soapenv:Body>
        <ar:FEParamGetTiposMonedas>
             <ar:Auth>
                <ar:Token>string</ar:Token>
                <ar:Sign>string</ar:Sign>
              <ar:Cuit>long</ar:Cuit>
           </ar:Auth>
        </ar:FEParamGetTiposMonedas>
     </soapenv:Body>
  </soapenv:Envelope>

---

<!-- page 107 -->

donde:

        Campo                              Detalle                        Obligatorio
                 Información de la autenticación. Contiene los datos de
 Auth                                                                         S
                 Token, Sign , Cuit
 Token           Token devuelto por el WSAA                                   S
 Sign            Sign devuelto por el WSAA                                    S
 Cuit            Cuit contribuyente (representado o Emisora)                  S


Mensaje de respuesta
  <?xml version=”1.0” encoding=”utf-8”?>
  <soap:Envelope xmlns:xsi=”http://www.w3.org/2001/XMLSchema-
  instance” xmlns:xsd=”http://www.w3.org/2001/XMLSchema”
  xmlns:soap=”http://schemas.xmlsoap.org/soap/envelope/”>
    <soap:Body>
      <FEParamGetTiposMonedasResponse
  xmlns=”http://ar.gov.afip.dif.fev1/”>
        <FEParamGetTiposMonedasResult>
          <ResultGet>
            <Moneda>
              <Id>string</Id>
              <Desc>string</Desc>
              <FchDesde>string</FchDesde>
              <FchHasta>string</FchHasta>
            </Moneda>
            <Moneda>
              <Id>string</Id>
              <Desc>string</Desc>
              <FchDesde>string</FchDesde>
              <FchHasta>string</FchHasta>
            </Moneda>
          </ResultGet>
          <Errors>
            <Err>
              <Code>int</Code>
              <Msg>string</Msg>
            </Err>
            <Err>
              <Code>int</Code>
              <Msg>string</Msg>
            </Err>
          </Errors>
          <Events>
            <Evt>
              <Code>int</Code>
              <Msg>string</Msg>
            </Evt>
            <Evt>
              <Code>int</Code>
              <Msg>string</Msg>
            </Evt>

---

<!-- page 108 -->

          </Events>
        </FEParamGetTiposMonedasResult>
      </FEParamGetTiposMonedasResponse>
    </soap:Body>
  </soap:Envelope>



donde:

FEParamGetTiposMonedasResult:

        Campo                                    Detalle                             Obligatorio
 ResultGet             Información de los tipos de monedas disponibles.                      N
 Errors                Información de errores detectados                                     N
 Events                Información de eventos                                                N


ResultGet: Detalle de los tipos de monedas; esta compuesto por los siguientes cam-
pos:
     Campo             Tipo                      Detalle                   Obligatorio
 Id                    String (3)     Código de moneda                                       S
 Desc                  String (250)   Descripción                                            S
 FchDesde              String (8)     Fecha de vigencia desde                                S
 FchHasta              String (8)     Fecha de vigencia hasta                                N



Recuperador de valores referenciales de códigos de Tipos de datos Opcionales
(FEParamGetTiposOpcional)

Este método permite consultar los códigos y descripciones de los tipos de datos Opcionales
que se encuentran habilitados para ser usados en el WS.



Dirección URL (Homologación)
Este servicio se llama desde:
https://wswhomo.afip.gov.ar/wsfev1/service.asmx?op= FEParamGetTiposOpcional




Mensaje de solicitud
Recibe las credenciales de autenticación y la cuit del usuario representado.

  <soapenv:Envelope
  xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:ar="http://ar.gov.afip.dif.FEV1/">
     <soapenv:Header/>
     <soapenv:Body>

---

<!-- page 109 -->

        <ar:FEParamGetTiposOpcional>
            <ar:Auth>
              <ar:Token>string</ar:Token>
              <ar:Sign>string</ar:Sign>
              <ar:Cuit>long</ar:Cuit>
           </ar:Auth>
        </ar:FEParamGetTiposOpcional>
     </soapenv:Body>
  </soapenv:Envelope>




donde:

   Campo                            Detalle                         Obligatorio
              Información de la autenticación. Contiene los datos
 Auth                                                                   S
              de Token, Sign , Cuit
 Token        Token devuelto por el WSAA                                S
 Sign         Sign devuelto por el WSAA                                 S
 Cuit         Cuit contribuyente (representado o Emisora)               S




Mensaje de respuesta
  <?xml version=”1.0” encoding=”utf-8”?>
  <soap:Envelope xmlns:xsi=”http://www.w3.org/2001/XMLSchema-
  instance” xmlns:xsd=”http://www.w3.org/2001/XMLSchema”
  xmlns:soap=”http://schemas.xmlsoap.org/soap/envelope/”>
    <soap:Body>
      <FEParamGetTiposOpcionalResponse
  xmlns=”http://ar.gov.afip.dif.fev1/”>
        <FEParamGetTiposOpcionalResult>
          <ResultGet>
            <OpcionalTipo>
              <Id>string</Id>
              <Desc>string</Desc>
              <FchDesde>string</FchDesde>
              <FchHasta>string</FchHasta>
            </OpcionalTipo>
            <OpcionalTipo>
              <Id>string</Id>
              <Desc>string</Desc>
              <FchDesde>string</FchDesde>
              <FchHasta>string</FchHasta>
            </OpcionalTipo>
          </ResultGet>
          <Errors>
            <Err>
              <Code>int</Code>
              <Msg>string</Msg>
            </Err>
            <Err>

---

<!-- page 110 -->

                 <Code>int</Code>
                 <Msg>string</Msg>
               </Err>
             </Errors>
             <Events>
               <Evt>
                 <Code>int</Code>
                 <Msg>string</Msg>
               </Evt>
               <Evt>
                 <Code>int</Code>
                 <Msg>string</Msg>
               </Evt>
             </Events>
           </FEParamGetTiposOpcionalResult>
         </FEParamGetTiposOpcionalResponse>
       </soap:Body>
     </soap:Envelope>



donde:
FEParamGetTiposOpcionalResult:

        Campo                                   Detalle                              Obligatorio


ResultGet            Información de los tipos de datos opcionales                         N
Errors               Información de errores detectados                                    N
Events               Información de eventos                                               N




ResultGet: Detalle de los tipos de datos opcionales; esta compuesto por los siguientes campos:



       Campo              Tipo                            Detalle                    Obligatorio
Id                   String (4)       Identificador de campo opcional                     S
Desc                 String (250)     Descripción                                         S
FchDesde             String (8)       Fecha de vigencia desde                             S
FchHasta             String (8)       Fecha de vigencia hasta                             N




Recuperador de valores referenciales de códigos de Tipos de Tributos
(FEParamGetTiposTributos)

Devuelve los posibles códigos de tributos que puede contener un comprobante y su
descripción.

---

<!-- page 111 -->

Dirección URL (Homologación)
Este servicio se llama desde:
https://wswhomo.afip.gov.ar/wsfev1/service.asmx?op=FEParamGetTiposTributos




Mensaje de solicitud
Recibe las credenciales de autenticación y la cuit del usuario representado.

  <soapenv:Envelope
  xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:ar="http://ar.gov.afip.dif.FEV1/">
     <soapenv:Header/>
     <soapenv:Body>
        <ar:FEParamGetTiposTributos>
            <ar:Auth>
              <ar:Token>string</ar:Token>
              <ar:Sign>string</ar:Sign>
              <ar:Cuit>long</ar:Cuit>
           </ar:Auth>
        </ar:FEParamGetTiposTributos>
     </soapenv:Body>
  </soapenv:Envelope>




donde:

        Campo                                  Detalle                          Obligatorio
                       Información de la autenticación. Contiene los datos de
 Auth                                                                               S
                       Token, Sign , Cuit
 Token                 Token devuelto por el WSAA                                   S
 Sign                  Sign devuelto por el WSAA                                    S
 Cuit                  Cuit contribuyente (representado o Emisora)                  S


Mensaje de respuesta
  <?xml version=”1.0” encoding=”utf-8”?>
  <soap:Envelope xmlns:xsi=”http://www.w3.org/2001/XMLSchema-
  instance” xmlns:xsd=”http://www.w3.org/2001/XMLSchema”
  xmlns:soap=”http://schemas.xmlsoap.org/soap/envelope/”>
    <soap:Body>
      <FEParamGetTiposTributosResponse
  xmlns=”http://ar.gov.afip.dif.fev1/”>
        <FEParamGetTiposTributosResult>
          <ResultGet>
            <TributoTipo>
              <Id>short</Id>

---

<!-- page 112 -->

                 <Desc>string</Desc>
                 <FchDesde>string</FchDesde>
                 <FchHasta>string</FchHasta>
               </TributoTipo>
               <TributoTipo>
                 <Id>short</Id>
                 <Desc>string</Desc>
                 <FchDesde>string</FchDesde>
                 <FchHasta>string</FchHasta>
               </TributoTipo>
             </ResultGet>
             <Errors>
               <Err>
                 <Code>int</Code>
                 <Msg>string</Msg>
               </Err>
               <Err>
                 <Code>int</Code>
                 <Msg>string</Msg>
               </Err>
             </Errors>
             <Events>
               <Evt>
                 <Code>int</Code>
                 <Msg>string</Msg>
               </Evt>
               <Evt>
                 <Code>int</Code>
                 <Msg>string</Msg>
               </Evt>
             </Events>
           </FEParamGetTiposTributosResult>
         </FEParamGetTiposTributosResponse>
       </soap:Body>
     </soap:Envelope>




donde:

FEParamGetTiposTributosResult:

         Campo                                     Detalle                                Obligatorio
ResultGet             Información de los tipos de tributos posibles.                          N
Errors                Información de errores detectados                                       N
Events                Información de eventos                                                  N


ResultGet: Detalle de los tipos de tributos; esta compuesto por los siguientes campos:

       Campo               Tipo                          Detalle                         Obligatorio
Id                    Int (2)        Código de Tributo                                       S
Desc                  String (250)   Descripción                                             S

---

<!-- page 113 -->

FchDesde               String (8)     Fecha de vigencia desde                             S
FchHasta               String (8)     Fecha de vigencia hasta                             N




Recuperador de los puntos de venta asignados a Facturación Electrónica que soporten
CAE y CAEA vía Web Services (FEParamGetPtosVenta)

Este método permite consultar los puntos de venta para ambos tipos de Código de
Autorización (CAE y CAEA) gestionados previamente por la CUIT emisora.



Dirección URL (Homologación)
Este servicio se llama desde:
https://wswhomo.afip.gov.ar/wsfev1/service.asmx?op= FEParamGetPtosVenta




Mensaje de solicitud
Recibe las credenciales de autenticación, cuit del usuario representado.

  <soapenv:Envelope
  xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:ar="http://ar.gov.afip.dif.FEV1/">
     <soapenv:Header/>
     <soapenv:Body>
        <ar:FEParamGetPtosVenta>
          <ar:Auth>
             <ar:Token>string</ar:Token>
             <ar:Sign>string</ar:Sign>
              <ar:Cuit>long</ar:Cuit>
           </ar:Auth>
        </ar:FEParamGetPtosVenta>
     </soapenv:Body>
  </soapenv:Envelope>



donde:
    Campo                                     Detalle                             Obligatorio
                    Información de la autenticación. Contiene los datos de
 Auth                                                                                 S
                    Token, Sign , Cuit
 Token              Token devuelto por el WSAA                                        S
 Sign               Sign devuelto por el WSAA                                         S
 Cuit               Cuit contribuyente (representado o Emisora)                       S

---

<!-- page 114 -->

Mensaje de respuesta
  <?xml version=”1.0” encoding=”utf-8”?>
  <soap:Envelope xmlns:xsi=”http://www.w3.org/2001/XMLSchema-
  instance” xmlns:xsd=”http://www.w3.org/2001/XMLSchema”
  xmlns:soap=”http://schemas.xmlsoap.org/soap/envelope/”>
    <soap:Body>
      <FEParamGetPtosVentaResponse
  xmlns=”http://ar.gov.afip.dif.FEV1/”>
        <FEParamGetPtosVentaResult>
          <ResultGet>
            <PtoVenta>
              <Nro>int</Nro>
              <EmisionTipo>string</EmisionTipo>
              <Bloqueado>string</Bloqueado>
              <FchBaja>string</FchBaja>
            </PtoVenta>
            <PtoVenta>
              <Nro>int</Nro>
              <EmisionTipo>string</EmisionTipo>
              <Bloqueado>string</Bloqueado>
              <FchBaja>string</FchBaja>
            </PtoVenta>
          </ResultGet>
          <Errors>
            <Err>
              <Code>int</Code>
              <Msg>string</Msg>
            </Err>
            <Err>
              <Code>int</Code>
              <Msg>string</Msg>
            </Err>
          </Errors>
          <Events>
            <Evt>
              <Code>int</Code>
              <Msg>string</Msg>
            </Evt>
            <Evt>
              <Code>int</Code>
              <Msg>string</Msg>
            </Evt>
          </Events>
        </FEParamGetPtosVentaResult>
      </FEParamGetPtosVentaResponse>
    </soap:Body>

  </soap:Envelope>



donde:
FEParamGetPtosVentaResult:

      Campo                         Detalle                     Obligatorio

---

<!-- page 115 -->

                       Información de los puntos de venta electrónicos habilitados
 ResultGet                                                                                N
                       para CAE o CAEA. Contiene el dato PtoVenta
 PtoVenta              Información sobre los puntos de venta                              S
 Errors                Información de errores detectados                                  N
 Events                Información de eventos                                             N




PtoVenta: Detalle de los tipos puntos de venta electrónicos; esta compuesto por los si-
guientes campos:
     Campo              Tipo                         Detalle                   Obligatorio
Nro                    Int (5)        Punto de venta                                       S
                                      Identifica si es punto de venta para CAE o
EmisionTipo            String (8)                                                          S
                                      CAEA
                                      Indica si el punto de venta esta bloqueado.
                                      De darse esta situación se deberá ingresar al
Bloqueado              String (1)                                                          S
                                      ABM de puntos de venta a regularizar la
                                      situación Valores S o N
FchBaja                String (8)     Indica la fecha de baja en caso de estarlo           N



Recuperador de cotización de moneda (FEParamGetCotizacion)

Retorna la última cotización de la base de datos aduanera de la moneda ingresada. Este valor
es orientativo.



Dirección URL (Homologación)
Este servicio se llama desde:
https://wswhomo.afip.gov.ar/wsfev1/service.asmx?op=
FEParamGetCotizacion




Mensaje de solicitud
Recibe las credenciales de autenticación, cuit del usuario representado y el código de
moneda.

  <soapenv:Envelope
  xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:ar="http://ar.gov.afip.dif.FEV1/">
     <soapenv:Header/>
     <soapenv:Body>

---

<!-- page 116 -->

        <ar:FEParamGetCotizacion>
            <ar:Auth>
             <ar:Token>string</ar:Token>
             <ar:Sign>string</ar:Sign>
              <ar:Cuit>long</ar:Cuit>
           </ar:Auth>
          <ar:MonId>string</ar:MonId>
          <!--Optional:-->
          <ar:FchCotiz>string</ar:FchCotiz>
        </ar:FEParamGetCotizacion>
     </soapenv:Body>
  </soapenv:Envelope>


donde:

        Campo                                Detalle                        Obligatorio
                  Información de la autenticación. Contiene los datos de
 Auth                                                                           S
                  Token, Sign , Cuit
 Token            Token devuelto por el WSAA                                    S
 Sign             Sign devuelto por el WSAA                                     S
 Cuit             Cuit contribuyente (representado o Emisora)                   S


        Campo                                Detalle                        Obligatorio
MonId              Código de moneda de la que se solicita cotización.           S

FchCotiz           Fecha a la cual se consulta la cotización de la moneda
                                                                                N
                   ingresada




Mensaje de respuesta



  <?xml version=”1.0” encoding=”utf-8”?>
  <soap:Envelope xmlns:xsi=”http://www.w3.org/2001/XMLSchema-
  instance” xmlns:xsd=”http://www.w3.org/2001/XMLSchema”
  xmlns:soap=”http://schemas.xmlsoap.org/soap/envelope/”>
    <soap:Body>
      <FEParamGetCotizacionResponse
  xmlns=”http://ar.gov.afip.dif.FEV1/”>
        <FEParamGetCotizacionResult>
          <ResultGet>
            <MonId>string</MonId>
            <MonCotiz>double</MonCotiz>
            <FchCotiz>string</FchCotiz>
          </ResultGet>
          <Errors>
            <Err>
              <Code>int</Code>

---

<!-- page 117 -->

               <Msg>string</Msg>
             </Err>
             <Err>
               <Code>int</Code>
               <Msg>string</Msg>
             </Err>
           </Errors>
           <Events>
             <Evt>
               <Code>int</Code>
               <Msg>string</Msg>
             </Evt>
             <Evt>
               <Code>int</Code>
               <Msg>string</Msg>
             </Evt>
           </Events>
         </FEParamGetCotizacionResult>
       </FEParamGetCotizacionResponse>
     </soap:Body>

  </soap:Envelope>


donde:
FEParamGetCotizacionResult:



Campo                Detalle                                                  Obligatorio
ResultGet            cotización de la moneda solicitada y fecha de la misma   S
Errors               Información de errores detectados                        N
Events               Información de eventos                                   N




ResultGet:
             Campo                      Tipo                    Detalle           Obligatorio
MonCotiz                           Double (4+6)     Cotización de la moneda       N
MonId                              String (3)       Código de moneda              S
FchCotiz                           String (8)       Fecha de la cotización.       N

---

<!-- page 118 -->

                                                    Formato yyyymmdd




Validaciones y errores


Validaciones que se aplican sobre el objeto <FEParamGetCotizacion>



Validaciones Excluyentes




                   Código
Campo/Grupo                                         Descripción de la validación
                   de error

                                Campo <MonId> debe ser algunos de los habilitados en el presente
    MonId           12000       WS. Para consultar los valores posible utilizar el método FEParamGe-
                                tTiposMonedas

    MonId           12001       Campo <MonId> es obligatorio ingresarlo.

                                Campo FchCotiz No corresponde a una fecha valida con formato YYY-
   FchCotiz         12002
                                YMMDD


Método para informar CAEA sin movimiento (FECAEASinMovimientoInformar)

Esta operación permite informar a la administración cuales fueron los CAEA’s otorgados que
no sufrieron movimiento alguno para un determinado punto de venta. El cliente envía el
requerimiento, el cual es atendido por el WS, superadas las validaciones de seguridad se
registrara la fecha por la cual se informo la falta de movimientos.



Dirección URL (Homologación)
Este servicio se llama desde:

https://wswhomo.afip.gov.ar/wsfev1/service.asmx?op=
FECAEASinMovimientoInformar

Mensaje de solicitud
  <soapenv:Envelope
  xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:ar="http://ar.gov.afip.dif.FEV1/">
     <soapenv:Header/>
     <soapenv:Body>
        <ar:FECAEASinMovimientoInformar>
          <ar:Auth>

---

<!-- page 119 -->

            <ar:Token>string</ar:Token>
            <ar:Sign>string</ar:Sign>
             <ar:Cuit>long</ar:Cuit>
           </ar:Auth>
           <ar:PtoVta>int</ar:PtoVta>
          <ar:CAEA>string</ar:CAEA>
        </ar:FECAEASinMovimientoInformar>
     </soapenv:Body>
  </soapenv:Envelope>




donde:



 Campo                 Detalle                                                      Obligatorio
                       Información de la autenticación. Contiene los datos de
 Auth                                                                                     S
                       Token, Sign y Cuit
 Token                 Token devuelto por el WSAA                                         S
 Sign                  Sign devuelto por el WSAA                                          S
 Cuit                  Cuit contribuyente (representado o Emisora)                        S


 Campo                 Detalle                                                      Obligatorio

 PtoVta                Punto de Venta para el que no se utilizó el CAEA informado        S

                       CAEA que se está informando como no utilizado para el
 CAEA                                                                                    S
                       punto de venta indicado


Mensaje de respuesta
Retorna el resultado del proceso de informar un CAEA como no utilizado.

  <?xml version=”1.0” encoding=”utf-8”?>
  <soap12:Envelope xmlns:xsi=”http://www.w3.org/2001/XMLSchema-
  instance” xmlns:xsd=”http://www.w3.org/2001/XMLSchema”
  xmlns:soap12=”http://www.w3.org/2003/05/soap-envelope”>
    <soap12:Body>
      <FECAEASinMovimientoResponse
  xmlns=”http://ar.gov.afip.dif.FEV1/”>
        <FECAEASinMovimientoResult>
          <CAEA>string</CAEA>
          <FchProceso>string</FchProceso>
          <Resultado>string</Resultado>
          <PtoVta>int</PtoVta>
          <Errors>
            <Err>
              <Code>int</Code>
              <Msg>string</Msg>

---

<!-- page 120 -->

            </Err>
            <Err>
              <Code>int</Code>
              <Msg>string</Msg>
            </Err>
          </Errors>
          <Events>
            <Evt>
              <Code>int</Code>
              <Msg>string</Msg>
            </Evt>
            <Evt>
              <Code>int</Code>
              <Msg>string</Msg>
            </Evt>
          </Events>
        </FECAEASinMovimientoResult>
      </FECAEASinMovimientoResponse>
    </soapenv:Body>

  </soapenv:Envelope>




donde:



        Campo                                  Detalle                            Obligatorio
                     Información completa del CAEA sin movimientos. Contiene
 FECAEASinMovimi
                     los datos CAEA, FchProceso, Resultado, PtoVta, Errors y           S
 entoResult
                     Events.
 Errors              Información de errores detectados                                 N
 Events              Información de eventos                                            N


FECAEASinMovimientoResult: El objeto resultante informante del resultado del proceso
contiene los siguientes campos:



        Campo                  Tipo                      Detalle                  Obligatorio
                                       Código de Autorización electrónico
 CAEA                String (14)                                                       S
                                       anticipado

                                       Fecha de Procesamiento del CAEA
 FchProceso          String (8)                                                        N
                                       informado como sin movimientos
 Resultado           String (1)        Aprobado o Rechazado                            N
                                       Punto de venta vinculado al CAEA
 PtoVta              Int (5)                                                           S
                                       informado.

---

<!-- page 121 -->

Validaciones y errores


Controles aplicados:



   Campo /         Código de
                                                              Validación
    Grupo            Error
                                El código de CAEA que se está informando debe ser del tipo de código
 <CAEA>                1200
                                de autorización CAEA
 <CUIT>                1201     Corresponda a la CUIT del Emisor indicada en <Auth><Cuit>
 <CAEA> /                       Que el CAEA / PtoVta no esté informado como utilizado en algún
                       1202
 <PtoVta>                       comprobante
 Fecha de
                                La fecha de envío de la solicitud debe ser mayor a la fecha de inicio de
 envío de la           1203
                                vigencia del CAEA que se está informando.
 solicitud
                                El PtoVta debe corresponder a un punto de venta habilitado para el
 <PtoVta>              1204
                                régimen CAEA
                                El punto de venta deberá haber estado activo durante la vigencia del
 <PtoVta>              1205
                                CAEA
 <PtoVta>              1206     El punto de venta deberá haber estar comprendido entre 1 y 99998
 <CAEA>                1207     CAEA y formato válido
 PtoVta                1209     El punto de venta informado como sin movimiento ya fue notificado



Método Dummy para verificación de funcionamiento de infraestructura (FEDummy)

Dirección URL (Homologación)
Este servicio se llama desde:
https://wswhomo.afip.gov.ar/wsfev1/service.asmx?op= FEDummy




Mensaje de solicitud
El método no posee parámetros de ingreso

  <soapenv:Envelope
  xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:ar="http://ar.gov.afip.dif.FEV1/">
     <soapenv:Header/>
     <soapenv:Body>
        <ar:FEDummy/>
     </soapenv:Body>

---

<!-- page 122 -->

  </soapenv:Envelope>



Mensaje de respuesta
Retorna la comprobación vía “ping” de los elementos principales de infraestructura del
servicio.

  <?xml version=”1.0” encoding=”utf-8”?>
  <soap:Envelope xmlns:xsi=”http://www.w3.org/2001/XMLSchema-
  instance” xmlns:xsd=”http://www.w3.org/2001/XMLSchema”
  xmlns:soap=”http://schemas.xmlsoap.org/soap/envelope/”>
    <soap:Body>
      <FEDummyResponse xmlns=”http://ar.gov.afip.dif.FEV1/”>
        <FEDummyResult>
          <AppServer>string</AppServer>
          <DbServer>string</DbServer>
          <AuthServer>string</AuthServer>
        </FEDummyResult>
      </FEDummyResponse>
    </soap:Body>

  </soap:Envelope>


donde:

               Campo                        Tipo                  Detalle                Obligatorio
AppServer                               String (2)     Servidor de aplicaciones                S
DbServer                                String (2)     Servidor de base de datos               S
AuthServer                              String (2)     Servidor de autenticación               S




Recuperador de ultimo valor de comprobante registrado (FECompUltimoAutorizado)

Retorna el ultimo comprobante autorizado para el tipo de comprobante / cuit / punto de venta
ingresado / Tipo de Emisión


Dirección URL (Homologación)
Este servicio se llama desde:
https://wswhomo.afip.gov.ar/wsfev1/service.asmx?
op=FECompUltimoAutorizado

Mensaje de solicitud
Recibe las credenciales de autenticación y la cuit del usuario representado.

  <soapenv:Envelope

---

<!-- page 123 -->

  xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:ar="http://ar.gov.afip.dif.FEV1/">
     <soapenv:Header/>
     <soapenv:Body>
        <ar:FECompUltimoAutorizado>
           <ar:Auth>
            <ar:Token>string</ar:Token>
            <ar:Sign>string</ar:Sign>
            <ar:Cuit>long</ar:Cuit>
           </ar:Auth>
           <ar:PtoVta>int</ar:PtoVta>
           <ar:CbteTipo>int</ar:CbteTipo>
        </ar:FECompUltimoAutorizado>
     </soapenv:Body>
  </soapenv:Envelope>




donde:

FECompUltimoAutorizado:



        Campo                                  Detalle                            Obligatorio
                     Información de la autenticación. Contiene los datos de
 Auth                                                                                  S
                     Token, Sign y Cuit
 Token               Token devuelto por el WSAA                                        S
 Sign                Sign devuelto por el WSAA                                         S
 Cuit                Cuit contribuyente (representado o Emisora)                       S



        Campo                                 Detalle                             Obligatorio
 PtoVta            Punto de venta                                                     S
 CbteTipo          Tipo de comprobante                                                S


Mensaje de respuesta
Retorna el último número de comprobante registrado para el punto de venta y tipo de
comprobante enviado.



  <?xml version=”1.0” encoding=”utf-8”?>
  <soap:Envelope xmlns:xsi=”http://www.w3.org/2001/XMLSchema-
  instance” xmlns:xsd=”http://www.w3.org/2001/XMLSchema”
  xmlns:soap=”http://schemas.xmlsoap.org/soap/envelope/”>
    <soap:Body>
      <FECompUltimoAutorizadoResponse
  xmlns=”http://ar.gov.afip.dif.FEV1/”>

---

<!-- page 124 -->

        <FECompUltimoAutorizadoResult>
          <PtoVta>int</PtoVta>
          <CbteTipo>int</CbteTipo>
          <CbteNro>int</CbteNro>
          <Errors>
            <Err>
              <Code>int</Code>
              <Msg>string</Msg>
            </Err>
            <Err>
              <Code>int</Code>
              <Msg>string</Msg>
            </Err>
          </Errors>
          <Events>
            <Evt>
              <Code>int</Code>
              <Msg>string</Msg>
            </Evt>
            <Evt>
              <Code>int</Code>
              <Msg>string</Msg>
            </Evt>
          </Events>
        </FECompUltimoAutorizadoResult>
      </FECompUltimoAutorizadoResponse>
    </soap:Body>

  </soap:Envelope>



donde:

FECompUltimoAutorizadoResult:

      Campo                                 Detalle                          Obligatorio
 FECompUltimoAut   Información completa del CAEA sin movimientos. Contiene
                                                                                 S
 orizadoResul      PtoVta, CbteTipo, CbteNro, Errors y Events
 Errors            Información de errores detectados                             N
 Events            Información de eventos                                        N




          Campo               Tipo                     Detalle                Obligatorio
 PtoVta             Int (5)           Punto de venta                               S
 CbteTipo           Int (3)           Tipo de comprobante                          S
 CbteNro            Long (8)          Número de comprobante                       N

---

<!-- page 125 -->

Validaciones, acciones y errores
Controles aplicados:



   Campo /         Código de
                                                               Validación
    Grupo            Error
 <PtoVta>              11000     El PtoVta debe ser válido comprendido entre 1 y 99998
                                 Debe de ser algunos de los habilitados en este WS. Consultar método
 <CbteTipo>            11001
                                 FEParamGetTiposCbte
                                 Debe ser un punto de venta habilitado en este WS. Consultar método
 <PtoVta>              11002
                                 FEParamGetPtosVenta




Recuperador de cantidad máxima de registros FECAESolicitar / FECAEARegInformativo
(FECompTotXRequest)

Retorna la cantidad máxima de registros que se podrá incluir en un request al método
FECAESolicitar / FECAEARegInformativo.



Dirección URL (Homologación)
Este servicio se llama desde:
https://wswhomo.afip.gov.ar/wsfev1/service.asmx?op= FECompTotXRequest




Mensaje de solicitud
Recibe las credenciales de autenticación y la cuit del usuario representado.

  <soapenv:Envelope
  xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:ar="http://ar.gov.afip.dif.FEV1/">
     <soapenv:Header/>
     <soapenv:Body>
        <ar:FECompTotXRequest>
             <ar:Auth>
              <ar:Token>string</ar:Token>
              <ar:Sign>string</ar:Sign>
              <ar:Cuit>long</ar:Cuit>
           </ar:Auth>
        </ar:FECompTotXRequest>
     </soapenv:Body>
  </soapenv:Envelope>

---

<!-- page 126 -->

donde:

        Campo                               Detalle                        Obligatorio
                  Información de la autenticación. Contiene los datos de
 Auth                                                                          S
                  Token, Sign y Cuit
 Token            Token devuelto por el WSAA                                   S
 Sign             Sign devuelto por el WSAA                                    S
 Cuit             Cuit contribuyente (representado o Emisora)                  S



Mensaje de respuesta


  <?xml version=”1.0” encoding=”utf-8”?>
  <soap:Envelope xmlns:xsi=”http://www.w3.org/2001/XMLSchema-
  instance” xmlns:xsd=”http://www.w3.org/2001/XMLSchema”
  xmlns:soap=”http://schemas.xmlsoap.org/soap/envelope/”>
    <soap:Body>
     <FECompTotXRequestResponse xmlns=”http://ar.gov.afip.dif.FEV1/”>
        <FECompTotXRequestResult>
          <RegXReq>int</RegXReq>
          <Errors>
            <Err>
              <Code>int</Code>
              <Msg>string</Msg>
            </Err>
            <Err>
              <Code>int</Code>
              <Msg>string</Msg>
            </Err>
          </Errors>
          <Events>
            <Evt>
              <Code>int</Code>
              <Msg>string</Msg>
            </Evt>
            <Evt>
              <Code>int</Code>
              <Msg>string</Msg>
            </Evt>
          </Events>
        </FECompTotXRequestResult>
      </FECompTotXRequestResponse>
    </soap:Body>
  </soap:Envelope>


Dónde:
FECompTotXRequestResult:

        Campo                               Detalle                        Obligatorio

 FECompTotXRequ   Contiene los datos RegXReq, Errors y Events.                 S

---

<!-- page 127 -->

 estResult
 Errors                 Información de errores detectados                                      N
 Events                 Información de eventos                                                 N




      Campo               Tipo                            Detalle                        Obligatorio
                                     Cantidad máxima de registros que se pueden
 RegXReq              Int (4)        incluir en un Request de solicitud de CAE e               S
                                     Informar CAEA.



Método para informar comprobantes emitidos con CAEA (FECAEARegInformativo)

Este método permite informar para cada CAEA otorgado, la totalidad de los comprobantes
emitidos y asociados a cada CAEA. Por cada comprobante se enviará una solicitud, la cual será
procesada por el WS pudiendo producirse alguna de las siguientes situaciones:



             Supere todas las validaciones, la solicitud es aprobada.

             No supere alguna de las validaciones excluyentes, la solicitud será rechazada.

             No supere alguna de las validaciones no excluyentes, la solicitud es aprobada con
              observaciones.



Dirección URL (Homologación)
Este servicio se llama desde:
https://wswhomo.afip.gov.ar/wsfev1/service.asmx?
op=FECAEARegInformativo

Mensaje de solicitud
Recibe la información del comprobante o lote de comprobantes.


  <soapenv:Envelope
  xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:ar="http://ar.gov.afip.dif.FEV1/">
     <soapenv:Header/>
     <soapenv:Body>
        <ar:FECAEARegInformativo>
           <ar:Auth>
              <ar:Token>string</ar:Token>
              <ar:Sign>string</ar:Sign>
              <ar:Cuit>long</ar:Cuit>
           </ar:Auth>
           <ar:FeCAEARegInfReq>
              <ar:FeCabReq>

---

<!-- page 128 -->

                 <ar:CantReg>int</ar:CantReg>
                 <ar:PtoVta>int</ar:PtoVta>
                 <ar:CbteTipo>int</ar:CbteTipo>
              </ar:FeCabReq>
              <ar:FeDetReq>
                 <ar:FECAEADetRequest>
                    <ar:Concepto>int</ar:Concepto>
                    <ar:DocTipo>int</ar:DocTipo>
                    <ar:DocNro>long</ar:DocNro>
                    <ar:CbteDesde>long</ar:CbteDesde>
                    <ar:CbteHasta>long</ar:CbteHasta>
                    <ar:CbteFch>string</ar:CbteFch>
                    <ar:ImpTotal>double</ar:ImpTotal>
                    <ar:ImpTotConc>double</ar:ImpTotConc>
                    <ar:ImpNeto>double</ar:ImpNeto>
                    <ar:ImpOpEx>double</ar:ImpOpEx>
                    <ar:ImpIVA>double</ar:ImpIVA>
                    <ar:ImpTrib>double</ar:ImpTrib>
                    <ar:FchServDesde>string</ar:FchServDesde>
                    <ar:FchServHasta>string</ar:FchServHasta>
                    <ar:FchVtoPago>string</ar:FchVtoPago>
                    <ar:MonId>string</ar:MonId>
                    <ar:MonCotiz>double</ar:MonCotiz>
                    <ar:CanMisMonExt>string</ar:CanMisMonExt>
                    <ar:CondicionIVAReceptorId>int</ar:CondicionIVA-
ReceptorId>
                    <ar:CbtesAsoc>
                       <ar:CbteAsoc>
                          <ar:Tipo>short</ar:Tipo>
                          <ar:PtoVta>int</ar:PtoVta>
                          <ar:Nro>long</ar:Nro>
                          <ar:Cuit>String</ar:Cuit>
                          <ar:CbteFch>String</ar:CbteFch>
                       </ar:CbteAsoc>
                    </ar:CbtesAsoc>
                    <ar:Tributos>
                       <ar:Tributo>
                          <ar:Id>short</ar:Id>
                          <ar:Desc>string</ar:Desc>
                          <ar:BaseImp>double</ar:BaseImp>
                          <ar:Alic>double</ar:Alic>
                          <ar:Importe>double</ar:Importe>
                       </ar:Tributo>
                    </ar:Tributos>
                    <ar:Iva>
                       <ar:AlicIva>
                          <ar:Id>short</ar:Id>
                          <ar:BaseImp>double</ar:BaseImp>
                          <ar:Importe>double</ar:Importe>
                       </ar:AlicIva>
                    </ar:Iva>
                    <ar:Opcionales>
                       <ar:Opcional>
                          <ar:Id>string</ar:Id>
                          <ar:Valor>string</ar:Valor>
                       </ar:Opcional>
                    </ar:Opcionales>
                    <ar:PeriodoAsoc>

---

<!-- page 129 -->

                        <ar:FchDesde>string</ar:FchDesde>
                        <ar:FchHasta>string</ar:FchHasta>
                     </ar:PeriodoAsoc>
                     <ar:CAEA>string</ar:CAEA>
                     <ar:CbteFchHsGen>string</ar:CbteFchHsGen>
                     <ar:Actividades>
                        <ar:Actividad>
                           <ar:Id>Long</ar:Id>
                        </ar:Actividad>
                     </ar:Actividades>
                </ar:FECAEADetRequest>
              </ar:FeDetReq>
           </ar:FeCAEARegInfReq>
        </ar:FECAEARegInformativo>
     </soapenv:Body>
  </soapenv:Envelope>

Dónde:
     Campo                                      Detalle                           Obligatorio
                     Información de la autenticación. Contiene los datos de
 Auth                                                                                  S
                     Token, Sign y Cuit
 Token               Token devuelto por el WSAA                                        S
 Sign                Sign devuelto por el WSAA                                         S
 Cuit                Cuit contribuyente (representado o Emisora)                       S



 Campo                  Detalle                                                   Obligatorio
                        Información del comprobante o lote de comprobantes de
 FeCAEARegInfReq                                                                       S
                        ingreso. Contiene los datos de FeCabReq y FeDetReq
                        Información de la cabecera del comprobante o lote de
 FeCabReq                                                                              S
                        comprobantes de ingreso
 FeDetReq /             Información del detalle del comprobante o lote de
                                                                                       S
 FECAEADetRequest       comprobantes de ingreso.


FeCabReq: La cabecera del comprobante o lote de comprobantes de ingreso está compuesta
por los siguientes campos:

 Campo           Tipo       Detalle                                               Obligatorio
                            Cantidad de registros del detalle del comprobante o
 CantReg         Int (4)                                                               S
                            lote de comprobantes de ingreso
                            Tipo de comprobante que se está informando. Si se
 CbteTipo        Int (3)    informa más de un comprobante, todos deben ser del         S
                            mismo tipo.

 PtoVta          Int (5)    Punto de Venta del comprobante que se está                 S
                            informando. Si se informa más de un comprobante,

---

<!-- page 130 -->

                              todos deben corresponder al mismo punto de venta.


FeDetReq: El detalle del comprobante o lote de comprobantes de ingreso esta compuesto por
los siguientes campos:

      Campo             Tipo                             Detalle                      Obligatorio
                                     Concepto del comprobante. Valores
                                     permitidos

 Concepto           Int (2)          1 Productos                                          S
                                     2 Servicios

                                     3 Productos y Servicios
                                     Código de documento identificatorio del
 DocTipo            Int (2)                                                               S
                                     comprador
 DocNro             Long (11)        Nro. De identificación del comprador                 S
                                     Nro. De comprobante desde
 CbteDesde          Long (8)                                                              S
                                     Rango 1- 99999999
                                     Nro. De comprobante registrado hasta
 CbteHasta          Long (8)                                                              S
                                     Rango 1- 99999999
                                     Fecha del comprobante (yyyymmdd). Para
                                     Concepto igual a 1, la fecha de emisión del
                                     comprobante puede ser hasta más 5 días
                                     respecto de la fecha de generación. La misma
 CbteFch            String (8)                                                            N
                                     no podrá exceder el mes de presentación. Si se
                                     indica Concepto igual a 2 ó 3 puede ser hasta
                                     10 días anteriores o posteriores a la fecha de
                                     generación
                                     Importe total del comprobante, Debe ser
                    Double           igual a Importe neto no gravado + Importe
 ImpTotal                                                                                 S
                    (13+2)           exento + Importe neto gravado + todos los
                                     campos de IVA al XX% + Importe de tributos
                                     Importe neto no gravado.
                    Double
 ImpTotConc                          Debe ser menor o igual a Importe total y no          S
                    (13+2)
                                     puede ser menor a cero.
                    Double           Importe neto gravado. Debe ser menor o igual
 ImpNeto                                                                                  S
                    (13+2)           a Importe total y no puede ser menor a cero.
                    Double           Importe exento. Debe ser menor o igual a
 ImpOpEx                                                                                  S
                    (13+2)           Importe total y no puede ser menor a cero.
                    Double
 ImpIVA                              Suma de los importes del array de IVA                S
                    (13+2)
 ImpTrib            Double           Suma de los importes del array de tributos           S

---

<!-- page 131 -->

      Campo           Tipo                         Detalle                       Obligatorio
                  (13+2)
                               Fecha de inicio del abono para el servicio a
                               facturar. Dato obligatorio para concepto 2 o
FchServDesde      String (8)                                                         N
                               3 (Servicios / Productos y Servicios). Formato
                               yyyymmdd
                               Fecha de fin del abono para el servicio a
                               facturar. Dato obligatorio para concepto 2 o
FchServHasta      String (8)   3 (Servicios / Productos y Servicios). Formato        N
                               yyyymmdd. FchServHasta no puede ser menor
                               a FchServDesde
                               Fecha de vencimiento del pago servicio a
                               facturar. Dato obligatorio para concepto 2 o
FchVtoPago        String (8)   3 (Servicios / Productos y Servicios). Formato        N
                               yyyymmdd. Debe ser igual o posterior a la
                               fecha del comprobante.
                               Código de moneda del comprobante.
MonId             String (3)   Consultar método FEParamGetMonedas para               S
                               valores posibles
                               Cotización de la moneda informada. Para PES,
                  Double       pesos argentinos la misma debe ser 1. De
MonCotiz                                                                             N
                  (4+6)        informar el campo, el mismo no puede quedar
                               vacío.
                               Marca que identifica si el comprobante se
CanMisMonExt      String (1)   cancela en misma moneda del comprobante               N
                               (moneda extranjera). Valores posibles S o N.
                               Condición Frente al IVA del receptor. Consultar
                               método “FEParamGetCondicionIvaReceptor”
CondicionIVARec                Campo obligatorio. Si el valor informado no es
                  Int (2)                                                            N
eptorId                        valido, para CAE rechazará y en CAEA
                               observará. Si el valor no existe rechazará en
                               ambos casos.
                               Array para informar los comprobantes
CbtesAsoc         Array                                                              N
                               asociados <CbteAsoc>
                               Array para informar los tributos asociados a un
Tributos          Array                                                              N
                               comprobante <Tributo>.
                               Array para informar las alícuotas y sus
IVA               Array                                                              N
                               importes asociados a un comprobante.
                               Array de campos auxiliares. Reservado usos
Opcionales        Array                                                              N
                               futuros. Adicionales por R.G.

PeriodoAsoc       Periodo      Estructura compuesta por la fecha desde y la          N
                               fecha hasta del periodo que se quiere

---

<!-- page 132 -->

        Campo               Tipo                       Detalle                       Obligatorio
                                   identificar
 CAEA                String (14)   Código de Autorización electrónico anticipado         S
                                   Fecha y Hora de generación del comprobante
 CbteFchHsGen        String(14)                                                          N
                                   por contingencia. Formato yyyymmddhhmiss
                                   Array para informar las actividades asociadas a
 Actividades         Actividad                                                           N
                                   un comprobante.


CbteAsoc: Detalle de los comprobantes relacionados con el comprobante que se está
informando (array).

        Campo           Tipo                           Detalle                       Obligatorio
                                   Código de tipo de comprobante. Consultar
 Tipo             Int (3)                                                                S
                                   método FEParamGetTiposCbte
 PtoVta           Int (5)          Punto de venta                                        S
 Nro              Long (8)         Numero de comprobante                                 S
 Cuit             Long (11)        Cuit Emisor del comprobante                           N
                                   Fecha del comprobante asociado . Formato
 CbteFch          String(8)                                                              N
                                   yyyymmdd




Tributos: Detalle de tributos relacionados con el comprobante que se está informando
(array).
      Campo             Tipo                        Detalle                    Obligatorio
Id                Int               Código tributo según método
                                                                                             S
                                    FEParamGetTiposTributos
Desc              String (80)       Descripción del tributo.                              N
BaseImp           Double (13+2)     Base imponible para la determinación del
                                                                                             S
                                    tributo.
Alic              Double (3+2)      Alícuota                                                 S
Importe           Double (13+2)     Importe del tributo                                      S




IVA: Detalle de alícuotas relacionadas con el comprobante que se está informando
(array).
      Campo            Tipo                      Detalle                   Obligatorio
Id                Int (2)           Código de tipo de iva. Consultar método                  S
                                    FEParamGetTiposIva
BaseImp           Double (13+2)     Base imponible para la determinación de la               S

---

<!-- page 133 -->

                                     alícuota.
Importe            Double (13+2)     Importe                                                   S


Opcionales: Campos auxiliares (array). Adicionales por R.G.

Los datos opcionales sólo deberán ser incluidos si el emisor pertenece al conjunto de emisores
habilitados a informar opcionales. En ese caso podrá incluir el o los datos opcionales que
correspondan, especificando el identificador de dato opcional de acuerdo a la situación del
emisor. El listado de tipos de datos opcionales se puede consultar con el método
FEParamGetTiposOpcional.

Ejemplo: si el emisor está incluido en el “Régimen de Promoción Industrial”, deberá incluir un
array de opcionales con un registro como el sig

        <ar:Opcionales>

                <ar:Opcional>

                       <ar:Id>2</ar:Id>

                       <ar:Valor>12345678</ar:Valor>

               </ar:Opcional>

        </ar:Opcionales>



      Campo                Tipo                          Detalle                        Obligatorio
Id                 String(4)         Código de Opcional, consultar método
                                                                                               S
                                     FEParamGetTiposOpcional
Valor              String (250)      Valor                                                     S



Periodo: Estructura que permite soportar un rango de fechas.

     Campo             Tipo                             Detalle                      Obligatorio

                                     Fecha correspondiente al inicio del perio-
 FchDesde        String(8)           do de los comprobantes que se quiere                  S
                                     identiricar

                                     Fecha correspondiente al fin del periodo
 FchHasta        String(8)           de los comprobantes que se quiere iden-               S
                                     tificar

---

<!-- page 134 -->

Actividad: Detalle de la actividad relacionada con las actividades (array) que se indi-
can en el comprobante a autorizar.
    Campo            Tipo                          Detalle                     Obligatorio
                                   Código actividad según método
 Id              Long (6)                                                                S
                                   FEParamGetActividades


Mensaje de respuesta
Retorna la información del comprobante o lote de comprobantes de ingreso. Ante cualquier
anomalía se retorna un array errores detectados (Errors) o un array de observaciones según
corresponda.

  <soap:Envelope xmlns:soap=”http://www.w3.org/2003/05/soap-envelope”
  xmlns:ar=”http://ar.gov.afip.dif.fev1/”>
     <soap:Header/>
     <soap:Body>
        <FECAEARegInformativoResponse>
           <FECAEARegInformativoResult>
              <FeCabResp>
                 <Cuit>long</Cuit>
                 <PtoVta>int</PtoVta>
                 <CbteTipo>int</CbteTipo>
                 <FchProceso>string</FchProceso>
                 <CantReg>int</CantReg>
                 <Resultado>string</Resultado>
              </FeCabResp>
              <FeDetResp>
                 <FECAEADetResponse>
                    <Concepto>int</Concepto>
                    <DocTipo>int</DocTipo>
                    <DocNro>long</DocNro>
                    <CbteDesde>long</CbteDesde>
                    <CbteHasta>long</CbteHasta>
                    <Resultado>string</Resultado>
                    <CAEA>string</CAEA>
                    <CbteFch>string</CbteFch>
                    <Obs>
                        <Observaciones>
                           <Code>int</Code>
                           <Msg>string</Msg>
                        </Observaciones>
                    </Obs>
                 </FECAEADetResponse>
              </FeDetResp>
              <Events>
                 <Evt>
                    <Code>int</Code>
                    <Msg>string</Msg>
                 </Evt>
              </Events>
              <Errors>
                 <Err>
                    <Code>int</Code>
                    <Msg>string</Msg>
                 </Err>

---

<!-- page 135 -->

              </Errors>
           </FECAEARegInformativoResult>
        </FECAEARegInformativoResponse>
     </soap:Body>
  </soap:Envelope>


Dónde:

          Campo                                       Detalle                           Obligatorio
 FECAEARegInformativo        Información del comprobante o lote de comprobantes de
 Result                      ingreso,                                                       S

                             Información de la cabecera del comprobante o lote de
 FeCabResp                   comprobantes enviada en el request + atributos                 S
                             adicionales como resultado y fecha de proceso.
                             Información del detalle del comprobante o lote de
                             comprobantes de ingreso + atributos adicionales como
                             ser:
 FeDetResp /
 FECAEADetResponse           resultado del procesamiento.                                   S

                             Fecha del comprobante.

                             Observaciones sobre el comprobante.
 Errors                      Información de errores detectados                              N
 Events                      Información de eventos                                         N



FeCabResp: La cabecera del comprobante o lote de comprobantes de ingreso estará
compuesta por los siguientes campos:



        Campo          Tipo                              Detalle                        Obligatorio
 Cuit              Long (11)        Cuit del contribuyente                                  S
 PtoVta            Int (5)          Punto de venta                                          S
 CbteTipo          Int (3)          Tipo de comprobante                                     S
 FchProceso        String (14)      Fecha de proceso formato yyyymmddhhmiss                 S
                                    Cantidad de registros del detalle del comprobante
 CantReg           Int (4)                                                                  S
                                    o lote de comprobantes de ingreso
 Resultado         String (1)       Resultado                                               S


FeDetResp: El detalle del comprobante o lote de comprobantes de ingreso estará compuesto
por los siguientes campos:

---

<!-- page 136 -->

       Campo             Tipo                           Detalle                          Obligatorio
 Concepto          Int (2)         Concepto                                                   S
                                   Código de documento identificatorio del
 DocTipo           Int (2)                                                                    S
                                   comprador
 DocNro            Long (11)       Nro. De identificación del comprador                       S
 CbteDesde         Long (8)        Nro. De comprobante desde                                  S
 CbteHasta         Long (8)        Nro. De comprobante registrado hasta                       S
 CbteFch           String (8)      Fecha del comprobante                                     N
 Resultado         String (1)      Resultado                                                  S
 CAEA              String (14)     Código de Autorización electrónico anticipado             N
 Observaciones     Array           Detalle de observaciones, del comprobante                 N


Observaciones: La estructura de datos Obs muestra el detalle de observaciones para un
comprobante determinado; estará compuesta por los siguientes campos:



       Campo             Tipo                           Detalle                          Obligatorio
 Code              Int (5)         Código de observación                                      S
 Msg               String (255)    Mensaje                                                    S


Validaciones y errores

Controles aplicados al objeto < Auth>
Validaciones Excluyentes

    Campo /        Código de
                                                          Descripción de la validación
     Grupo           error
                                  La CUIT del emisor debe estar registrada y activa en las bases de la
 <Auth><Cuit>        10000
                                  Administración.




Controles aplicados al objeto <FeCabReq>
Validaciones Excluyentes

    Campo /        Código de
                                                         Descripción de la validación
     Grupo           error
                                  Cantidad de registros de detalle del comprobante o lote de comprobantes
 <CantReg>           10001
                                  de ingreso <CantReg> debe estar comprendido entre 1 y 9998

---

<!-- page 137 -->

  Campo /     Código de
                                                  Descripción de la validación
   Grupo        error
                          La cantidad de registros del detalle del comprobante o lote de
<CantReg>      10002      comprobantes de ingreso debe ser igual a lo informado en cabecera del
                          comprobante o lote de comprobantes de ingreso <CantReg>.
                          La cantidad de registros en detalle debe ser menor igual al valor permitido.
Cantidad de
                          Consulte método FECompTotXRequest para obtener cantidad máxima de
registros      10003
                          registros por cada requerimiento. Para comprobantes del tipo MiPyMEs
incluidos
                          (FCE), la cantidad habilitada es 1 comprobante por request
                          Obligatorio. Valores permitidos:

                          1: Factura A

                          2: Nota de Débito A

                          3: Nota de Crédito A

                          4: Recibo A

                          6: Factura B

                          7: Nota de Débito B

                          8: Nota de Crédito B

                          9: Recibo B

                          11: Factura C

                          12: Nota de Débito C

                          13: Nota de Crédito C
CbteTipo        700       15: Recibo C

                          51: Factura “A con leyenda operación sujeta a retención” (CAEA observa
                          comprobante)

                          52: Nota de Débito “A con leyenda operación sujeta a retención” (CAEA
                          observa comprobante)

                          53: Nota de Crédito “A con leyenda operación sujeta a retención” (CAEA
                          observa comprobante)

                          54: Recibo “A con leyenda operación sujeta a retención”

                          63: Liquidaciones A

                          64: Liquidaciones B

                          201: Factura de Crédito electrónica MiPyMEs (FCE) A

                          202: Nota de Débito electrónica MiPyMEs (FCE) A

                          203: Nota de Crédito electrónica MiPyMEs (FCE) A

                          206: Factura de Crédito electrónica MiPyMEs (FCE) B

---

<!-- page 138 -->

    Campo /         Código de
                                                        Descripción de la validación
     Grupo            error
                                207: Nota de Débito electrónica MiPyMEs (FCE) B

                                208: Nota de Crédito electrónica MiPyMEs (FCE) B

                                211: Factura de Crédito electrónica MiPyMEs (FCE) C

                                212: Nota de Débito electrónica MiPyMEs (FCE) C

                                213: Nota de Crédito electrónica MiPyMEs (FCE) C

                                Consultar método FEParamGetTiposCbte
 PtoVta               1300      Campo PtoVta debe estar comprendido entre 1 y 99998.
                                El punto de Venta debe ser del tipo habilitado para CAEA - Fact. Elect.
                                (RECE) - RI IVA / CAEA – Fact. Elect. (RECE) - Contingencias / CAEA – Fact.
 PtoVta                701      Elect. (RECE) - Exento en IVA - Contingencias / CAEA – Fact. Elect. (RECE) -
                                Monotributo - Contingencias y no debe estar bloqueado a la fecha en que
                                se emitió el comprobante. Consultar método FEParamGetPtosVenta.




Verificaciones que se realizan sobre el elemento < FECAEADetRequest>



Validaciones Excluyentes


                                     Código de
           Campo / Grupo                                                 Validación
                                       Error
                                                    Debe estar comprendida dentro de la fecha desde
 CbteFch                                702
                                                    y fecha hasta de vigencia del CAEA

 CbteDesde / CbteHasta / PtoVta /                   El número de comprobante informado debe ser
 CbteTipo                                           mayor en 1 al último informado para igual punto
                                        703
                                                    de venta y tipo de comprobante. Consultar
                                                    método FECompUltimoAutorizado

 CbteFch / PtoVta / CbteTipo                        La fecha del comprobante debe ser mayor o igual
                                        704
                                                    a la fecha del último comprobante informado para

---

<!-- page 139 -->

                                 Código de
         Campo / Grupo                                             Validación
                                   Error
                                             igual tipo de comprobante y punto de venta.
CAEA                               705       Debe corresponder a la CUIT que está informando
                                             Al informar un comprobante con la modalidad
                                             CAEA, la fecha en la que se informa el
Fecha de envío de la solicitud     1414
                                             comprobante debe ser mayor a la fecha de
                                             entrada en vigencia del CAEA vinculado
                                             La fecha de alta del punto de venta deberá ser
CAEA / PtoVta                      709       menor o igual a la fecha de vigencia “hasta” del
                                             CAEA
                                             El campo MonId es obligatorio y debe
MonId                              1401      corresponder a algún valor devuelto por el
                                             método FEParamGetTiposMonedas.
                                             Valores permitidos:

                                             1 Productos
Concepto
                                   713       2 Servicios

                                             3 Productos y Servicios

                                             Consultar método FEParamGetTiposConcepto
                                             Si ImpIVA es igual a 0 los objetos Iva y AlicIva solo
                                             deben informarse con ImpIVA = 3 (iva 0)

                                             Si ImpIVA es mayor a 0 el objeto Iva y AlicIva son
ImpIVA / Iva / AlicIva             715
                                             obligatorios.

                                             El objeto AlicIva es obligatorio y no debe ser nulo
                                             si ingresa Iva.
                                             El campo ImpTotConc (Importe neto no gravado)
                                             no puede ser menor a cero (0).
<ImpTotConc>                       717
                                             El campo ImpTotConc soporta 13 números para la
                                             parte entera y 2 para los decimales.
                                             El campo ImpOpEx soporta 13 números para la
                                             parte entera y 2 para los decimales.
<ImpOpEx>                          718
                                             El campo ImpOpEx (importe exento) no puede ser
                                             menor a cero (0).
                                             El campo ImpNeto (Importe neto gravado) no
                                             puede ser menor a cero (0)
<ImpNeto>                          719
                                             El campo ImpNeto soporta 13 números para la
                                             parte entera y 2 para los decimales.
<ImpTrib>                          723       El campo ImpTrib (Importe de tributos) no puede

---

<!-- page 140 -->

                                 Código de
          Campo / Grupo                                          Validación
                                   Error
                                             ser menor a cero (0).

                                             El campo ImpTrib soporta 13 números para la
                                             parte entera y 2 para los decimales.
                                             El campo ImpIVA (Importe de IVA) no puede ser
                                             menor a cero (0).
<ImpIVA>                           1407
                                             El campo ImpIVA soporta 13 números para la
                                             parte entera y 2 para los decimales.
                                             El campo MonCotiz es obligatorio y mayor a 0

                                             Debe ser igual a 1 (uno) si <MonId> es igual a PES.
                                             Si <MonId> es diferente a PES que <MonCotiz> sea
                                             Mayor a 0.

<MonCotiz>                         726       El campo MonCotiz es opcional si informa el
                                             campo CanMisMonExt con el valor S y el tipo de
                                             comprobante es factura y la moneda tiene
                                             cotización en Banco Nación.

                                             El campo MonCotiz soporta 4 números para la
                                             parte entera y 6 para los decimales.
                                             Deberá corresponder a un CAEA registrado en las
CAEA                               780
                                             bases de la Administración
                                             La fecha de alta del punto de venta deberá ser
PtoVta / CbteFch                   781
                                             menor o igual a la fecha del comprobante
CAEA                               782       Obligatorio, numérico de 14 posiciones
CbteFch                            783       Obligatorio, formato yyyymmdd
                                             Obligatorio, entero; valores comprendidos entre 1
CbteDesde / CbteHasta              784
                                             y 99999999.
                                             Para comprobantes tipo B, <CbteHasta> sea mayor
<CbteHasta> / <CbteDesde>          1416
                                             o igual a <CbteDesde>
                                             Para comprobantes tipo B (CbteDesde distinto a
                                             CbteHasta) y el resultado de la operación ImpTotal
<CbteTipo> / <CbteDesde> /
                                   1415      / (CbteHasta – CbteDesde + 1 ) < monto en pesos
<CbteHasta>
                                             resultante según RG4444, el campo DocNro
                                             deberá ser cero (0) y el campo 140DocTipo 99.
                                             Para comprobantes B o C (CbteDesde igual a
                                             CbteHasta) mayor o igual a monto en pesos
DocTipo / DocNro / CbteDesde /
                                             resultante según RG4444, DocTipo debe ser uno
CbteHasta                          1417
                                             de los valores devueltos por el método
                                             FEParamGetTiposDoc distinto a 99 y DocNro
                                             deberá ser mayor a 0.
DocTipo / DocNro / CbteDesde /     1418      Para comprobantes B o C (CbteDesde igual a

---

<!-- page 141 -->

                                 Código de
        Campo / Grupo                                             Validación
                                   Error
                                             CbteHasta) menor a monto en pesos resultante
CbteHasta
                                             según RG4444, si DocTipo = 99 DocNro debe ser
                                             igual a 0.
                                             Para comprobantes B o C (CbteDesde igual a
DocTipo / DocNro / CbteDesde /
                                             CbteHasta) menor a monto en pesos resultante
CbteHasta                          1419
                                             según RG4444, si DocTipo es distinto a 99, DocNro
                                             debe ser mayor a 0.
                                             Para comprobantes tipo B, <CbteDesde> distinto a
<CbteTipo> / <CbteDesde> /                   <CbteHasta> el resultado de la operación
                                   1422
<CbteHasta>                                  ImpTotal / (CbteHasta – CbteDesde + 1 ) < monto
                                             en pesos resultante según RG4444.
                                             Para comprobantes clase A y comprobantes
<CbteTipo> / <CbteDesde> /
                                   711       MiPyMEs (FCE) el campo CbteDesde debe ser igual
<CbteHasta>
                                             al campo CbteHasta
                                             Para comprobantes clase A el campo DocTipo
<CbteTipo> / <DocTipo>             1403
                                             debe ser igual a 80 (CUIT)
                                             El campo ImpTotal no puede ser menor a cero (0).
<ImpTotal>                         1409      El campo ImpTotal soporta 13 números para la
                                             parte entera y 2 para los decimales.
                                             Para comprobantes tipo B o tipo C, si informa
                                             <DocTipo> y <DocNro>, <DocTipo> debe ser un
<DocTipo> / <DocNro>               1404
                                             valor devuelto por el método
                                             FEParamGetTiposDoc.
                                             Para comprobantes tipo B o tipo C el campo
<CbteTipo> / <DocNro>              1405      DocNro debe ser un valor comprendido entre 0 y
                                             99999999999
                                             Para comprobantes tipo A el campo DocNro debe
<CbteTipo> / <DocNro>              1421      ser un valor comprendido entre 20000000000 y
                                             60000000000
                                             Cuando se informa tipo de comprobante 80, el
DocTipo / DocNro                   788       documento informado no puede ser el mismo al
                                             ingresado en el campo <Auth><Cuit>
                                             Si ImpTrib es igual a 0 el objeto Tributos y Tributo
                                             no deben informarse.

<ImpTrib> / <Tributos> /                     Si ImpTrib es mayor a 0 el objeto Tributos y
                                   1423
<Tributo>                                    Tributo son obligatorios.

                                             Si ImpTrib mayor a 0, Tributos y Tributo no pueden
                                             venir vacíos.
<Opcionales><CbteTipo>             1426      El array <Opcionales> no es obligatorio. Solo

---

<!-- page 142 -->

                        Código de
        Campo / Grupo                                   Validación
                          Error
                                    puede informarse si <CbteTipo> es 1, 2, 3, 4, 5, 6,
                                    7, 8, 34, 39, 60, 63, 64, 201, 202, 203, 206, 207,
                                    208, 211, 212, 213
                                    No se encuentra habilitado informar compradores
<Compradores>             1432      en el régimen de información para la modalidad
                                    CAEA.
<CbteTipo>/                         Para comprobantes tipo C <CbteHasta> debe ser
                                    igual a <CbteDesde>.
<CbteDesde>/              1433

<CbteHasta>

<CbteTipo>/                         Para comprobantes tipo C, el campo “Importe
                          1434      neto no gravado” <ImpTotConc> debe ser igual a
<ImpTotConc>                        cero (0).
<CbteTipo>/                         Para comprobantes tipo C, el campo <ImpOpEx>
                          1435      debe ser igual a cero (0).
<ImpOpEx>
<CbteTipo>/                         Para comprobantes tipo C el campo <ImpNeto>
                          1436      corresponde al Importe del Sub Total.
<ImpNeto>

<CbteTipo>/                         Para comprobantes tipo C, el campo “Importe de
                          1437      tributos” <ImpTrib>. No puede ser menor a cero
<ImpTrib>                           (0).
<CbteTipo>/                         Para comprobantes tipo C, el campo “Importe de
                          1438      IVA” < ImpIVA> debe ser igual a cero (0).
<ImpIVA>
                                    Para comprobantes tipo C, el campo “Importe
                                    Total” <ImpTotal>, debe ser igual a la suma de
<CbteTipo>/
                                    ImpNeto + ImpTrib.
<ImpTotal>/
                          1439
<ImpNeto> /
                                    Margen de error:
<ImpTrib> /
                                    Error relativo porcentual deberá ser <= 0.01% o el
                                    error absoluto <=0.01
                                    Si el punto de venta es para CONTINGENCIAS
<CbteFchHsGen>            1440
                                    CAEA el campo es obligatorio informarlo
                                    Si informa el campo, el mismo tiene que contener
<CbteFchHsGen>            1441      un valor según lo definido en la estructura.
                                    Formato yyyymmddhhmiss
                                    Si el tipo de comprobante es C, el array de IVA no
<Iva>                     1443
                                    debe informarse.

<PtoVta> /<CbteTipo>      1444      Si el comprobante es tipo “A”, “B”, “A con leyenda
                                    operación sujeta a retención” los puntos de venta

---

<!-- page 143 -->

                               Código de
        Campo / Grupo                                           Validación
                                 Error
                                           habilitados son CAEA - Fact. Elect. (RECE) - RI IVA /
                                           CAEA - Fact. Elect. (RECE) - RI IVA - Contingencias.

                                           Si el comprobante es tipo C, los puntos de venta
                                           habilitados son CAEA - Fact. Elect. (RECE) - Exento
                                           en IVA – Contingencias /
                                           CAEA - Fact. Elect. (RECE) - Monotributo -
                                           Contingencias
                                           Si el tipo de comprobante que está autorizando es
<FeCabReq><CbteTipo> /                     MiPyMEs (FCE), el campo DocNro para
                                 1445
<CbteTipo> / <DocNro>                      comprobantes deberá ser un valor registrado en el
                                           padrón de arca, en condición activa.
                                           Si el tipo de comprobante que está autorizando es
                                           MiPyMEs (FCE), el campo DocNro para
<CbteTipo> / <DocNro>            1446
                                           comprobantes deberá ser un valor registrado en el
                                           padrón de arca, en condición activa.
                                           Si el tipo de comprobante que está autorizando es
<FeCabReq><CbteTipo>/                      MiPyMEs (FCE) y corresponde a un comprobante
                                 1450
<FECAEDetRequest><CbtesAsoc>               de débito o crédito, es obligatorio informar
                                           comprobantes asociados.
                                           Si el tipo de comprobante que está autorizando es
                                           MiPyMEs (FCE) y corresponde a un comprobante
                                           de débito o crédito. Tener en cuenta que:

                                           - sí el comprobante asociado se encuentra
                                           rechazado por el comprador hay que informar el
<FeCabReq><CbteTipo>/                      código de anulación correspondiente sobre el
<CbteAsoc><Tipo><PtoVta><Nro     1451      campo "Adicionales por RG", códigos 22 -
><Cuit>                                    Anulación. Valor “S”

                                           - sí el comprobante asociado no se encuentra
                                           rechazado por el comprador hay que informar el
                                           código de no anulación correspondiente sobre el
                                           campo "Adicionales por RG", códigos 22 -
                                           Anulación. Valor “N”
<Auth><Cuit>                               Si el tipo de comprobante que está autorizando es
                                           MiPyMEs (FCE), el CUIT del emisor del
<FeCabReq><CbteTipo>/            1452
                                           comprobante asociado debe coincidir con el CUIT
<CbteAsoc><Cuit>                           del emisor del comprobante a autorizar.

                                           Si el tipo de comprobante que está autorizando es
<FeCabReq><CbteTipo>/                      MiPyMEs (FCE), Débito o Crédito sin código de
                                 1453
<CbteAsoc><Tipo>                           Anulación siempre debe asociar 1 solo
                                           comprobante tipo factura.

<FeCabReq><CbteTipo>/            1454      Si el tipo de comprobante que está autorizando es
                                           MiPyMEs (FCE), Débito o Crédito sin código de

---

<!-- page 144 -->

                                   Código de
        Campo / Grupo                                              Validación
                                     Error
                                               Anulación solo puede asociar:

                                               Para comprobantes A, asociar 201 o (91, 88, 988,
                                               990, 991, 993, 994, 995, 996, 997).
<CbteAsoc><Tipo>                               Para comprobantes B, asociar 206 o (91, 88, 988,
                                               990, 991, 993, 994, 995, 996, 997).

                                               Para comprobantes C, asociar 211 o (91, 88, 988,
                                               990, 991, 993, 994, 995, 996, 997).
<FeCabReq><CbteTipo>/                          Si el tipo de comprobante que está autorizando es
                                               MiPyMEs (FCE), Débito o Crédito, es obligatorio
<CbteAsoc> / <Tipo> / <PtoVta> /     1455
                                               informar la fecha del comprobante asociado
<Nro> / <Cuit> / <CbteFch>
<FeCabReq><CbteTipo>/                          Si el tipo de comprobante que está autorizando es
                                               MiPyMEs (FCE), Débito o Crédito, la fecha del
<FeDetReq>/<CbteFch>/
                                               comprobante asociado tiene que ser igual o
<CbteAsoc> / <Tipo> / <PtoVta> /     1456      menor a la fecha del comprobante que se está
                                               autorizando
<Nro> / <Cuit> / <CbteFch>


                                               Si el tipo de comprobante que está autorizando es
<FeCabReq><CbteTipo>/
                                               MiPyMEs (FCE), Débito o Crédito, el comprobante
<CbteAsoc> / <Tipo> / <PtoVta> /     1457      debe existir autorizado en las bases de esta
                                               Administración con la misma fecha informada en
<Nro> / <Cuit> / <CbteFch>
                                               el asociado.
<FeCabReq><CbteTipo>/                          Si el tipo de comprobante que está autorizando es
                                     1458      MiPyMEs (FCE), el receptor del comprobante debe
<FECAEDetRequest><DocTipo><
                                               tener habilitado el domicilio fiscal electrónico
DocNro>

<FeCabReq><CbteTipo>/                          Si el tipo de comprobante que está autorizando es
                                     1459      MiPyMEs (FCE)
<Opcionales>                                   es obligatorio informar <Opcionales>
                                               Si el tipo de comprobante que está autorizando es
                                               MiPyMEs (FCE), Tipo 201 - FACTURA DE CREDITO
<FeCabReq><CbteTipo>/
                                     1460      ELECTRONICA MiPyMEs (FCE) A / 206 - FACTURA
<FchVtoPago>                                   DE CREDITO ELECTRONICA MiPyMEs (FCE) B / 211
                                               - FACTURA DE CREDITO ELECTRONICA MiPyMEs
                                               (FCE) C, es obligatorio informar FchVtoPago
                                               Si el tipo de comprobante que está autorizando es
<FeCabReq><CbteTipo>/
                                               MiPyMEs (FCE), la fecha de vencimiento de pago
<FchVtoPago> /                       1461      (FchVtoPago) debe ser posterior o igual a la fecha
<FECAEDetRequest><CbteFch>                     de emisión (CbteFch) o fecha de presentación (fe-
                                               cha actual), la que sea posterior
<FeCabReq><CbteTipo>/                1462      Si el tipo de comprobante que está autorizando es

---

<!-- page 145 -->

                          Código de
        Campo / Grupo                                     Validación
                            Error
                                      MiPyMEs (FCE), informa opcionales, el valor co-
<Opcionales><Id><Valor>               rrecto para el código 2101 es un CBU numérico de
                                      22 caracteres.
                                      Si el tipo de comprobante que está autorizando es
<FeCabReq><CbteTipo>/
                            1463      MiPyMEs (FCE), informa opcionales, el valor co-
<Opcionales><Id><Valor>               rrecto para el código 2102 es un ALIAS alfanuméri-
                                      co de 6 a 20 caracteres.
                                      Si el tipo de comprobante que está autorizando es
<FeCabReq><CbteTipo>/                 MiPyMEs (FCE), informa opcionales, el valor co-
                            1464      rrecto para el código 22 es “S” o “N”:
<Opcionales><Id><Valor>
                                      S = Es de Anulación
                                      N = No es de Anulación
<FeCabReq><CbteTipo>/                 Si el tipo de comprobante que está autorizando es
                            1465      Factura (201, 206, 211) del tipo MiPyMEs (FCE), in-
<Opcionales><Id><Valor>
                                      forma opcionales, es obligatorio informar CBU.
<FeCabReq><CbteTipo>/                 Si el tipo de comprobante que está autorizando
                            1466      NO es MiPyMEs (FCE), no informar los códigos
<Opcionales><Id><Valor>
                                      2101, 2102, 22, 27
<FeCabReq><CbteTipo>/                 Si el tipo de comprobante que está autorizando es
                            1467      MiPyMEs (FCE), es obligatorio informar al menos
<Opcionales><Id><Valor>
                                      uno de los sig. códigos 2101, 22, 27
<FeCabReq><CbteTipo>/                 Si el tipo de comprobante que está autorizando es
                            1468      MiPyMEs (FCE), Factura (201, 206, 211), no infor-
<Opcionales><Id><Valor>
                                      mar Código de Anulación
<FeCabReq><CbteTipo>/                 Si el tipo de comprobante que está autorizando es
                            1469      MiPyMEs (FCE), Debito (202, 207, 212) o Crédito
<Opcionales><Id><Valor>
                                      (203, 208, 213) No informar CBU y ALIAS.
<FeCabReq><CbteTipo>/                 Si el tipo de comprobante que está autorizando es
                            1470      MiPyMEs (FCE), Debito (202, 207, 212) o Crédito
<Opcionales><Id><Valor>
                                      (203, 208, 213) informar Código de Anulación
                                      Si el tipo de comprobante que está autorizando es
<FeCabReq><CbteTipo>/
                            1471      factura MiPyMEs (FCE), el CBU debe estar registra-
<Opcionales><Id><Valor>               do en las bases de esta administración, vigente y
                                      pertenecer al emisor del comprobante.
                                      Si el tipo de comprobante que está autorizando es
                                      MiPyMEs (FCE), el campo “fecha de vencimiento
<FeCabReq><CbteTipo>/                 para el pago” <FchVtoPago> no debe informarse
                            1472
<FchVtoPago>                          si NO es Factura de Crédito. En el caso de ser
                                      Débito o Crédito, solo puede informarse si es de
                                      Anulación.
                                      Si el tipo de comprobante que está autorizando es
<FeCabReq><CbteTipo>/                 MiPyMEs (FCE) del tipo A, el receptor del
                            1474      comprobante informado en DocTipo y DocNro
<CbteTipo> / <DocNro>
                                      debe corresponder a un contribuyente activo en el
                                      Impuesto al Valor Agregado o Responsable

---

<!-- page 146 -->

                              Código de
        Campo / Grupo                                         Validación
                                Error
                                          Monotributo.

                                          Si el tipo de comprobante que está autorizando es
                                          MiPyMEs (FCE) del tipo B, el receptor del
                                          comprobante informado en DocTipo y DocNro
                                          debe corresponder a un contribuyente activo en el
                                          Impuesto Iva, Monotributo o Exento.

                                          Si el tipo de comprobante que esta autorizando es
                                          MiPyMEs (FCE) del tipo C, el receptor del
                                          comprobante informado en DocTipo y DocNro
                                          debe corresponder a un contribuyente activo en el
                                          Impuesto Iva, Monotributo o Exento.

<FeCabReq><CbteTipo>/                     Si el tipo de comprobante que está autorizando es
                                1475      MiPyMEs (FCE) no se permite informar DocNro
<CbteTipo> / <DocNro>                     23000000000 (No Categorizado)
                                          Si el tipo de comprobante que está autorizando es
                                          MiPyMEs (FCE), el receptor del comprobante
<FeCabReq><CbteTipo>/                     informado en DocTipo y DocNro debe
                                1476      corresponder a un contribuyente caracterizado
<CbteTipo> / <DocNro>                     como GRANDE o que opto por PYME. Su activida
                                          principal debe corresponderse con alguna de las
                                          alcanzadas por el régimen.

<FeCabReq><CbteTipo>/                     Si el tipo de comprobante que está autorizando es
<MonId>                                   MiPyMEs (FCE), débito o crédito, el mismo debe
                                          tener la misma moneda que el comprobante aso-
                                1477
<CbteAsoc>                                ciado o Pesos para ajuste en las diferencias de
                                          cambio (post aceptación/rechazo)

                                          Si el tipo de comprobante que está autorizando es
                                          MiPyMEs (FCE), es débito o crédito, deben
<FeCabReq><CbteTipo>/                     coincidir emisores y receptores.
<FECAEDetRequest><DocTipo><               Si el comprobante ES de anulación, para autorizar
                                1478
DocNro>/                                  un débito, el tipo de comprobante a asociar debe
<CbteAsoc>                                ser crédito y para autorizar un crédito, el tipo de
                                          comprobante a asociar debe ser una factura o un
                                          débito.
<FeCabReq><CbteTipo>/                     Si el tipo de comprobante que está autorizando es
<MonId>                                   MiPyMEs (FCE), es crédito el monto del
                                1479      comprobante a autorizar no puede ser mayor o
<CbteAsoc>/
                                          igual al saldo actual de la cuenta corriente. Ver
<FeCabReq><ImpTotal>                      micrositio factura de crédito

<FeCabReq><CbteTipo>/           1480      Si el tipo de comprobante que está autorizando es
                                          MiPyMEs (FCE), es crédito o débito A, de

---

<!-- page 147 -->

                                   Código de
        Campo / Grupo                                              Validación
                                     Error
                                               anulación, solo se encuentra habilitado asociar un
<CbteAsoc>/                                    comprobante de crédito A. Utilizar debito para
                                               anular crédito o utilizar crédito para anular débito
                                               o factura.
                                               Si el tipo de comprobante que está autorizando es
<FeCabReq><CbteTipo>/                          MiPyMEs (FCE), es crédito o débito B, de
                                               anulación, solo se encuentra habilitado asociar un
<CbteAsoc>/                          1481
                                               comprobante de crédito B. Utilizar debito para
                                               anular crédito o utilizar crédito para anular débito
                                               o factura.
                                               Puede identificar una o varias Referencias
<FeCabReq><CbteTipo>/                          Comerciales según corresponda. Informar bajo el
                                     1482
<Opcionales><Id><Valor>                        código 23. Campo alfanumérico de 50 caracteres
                                               como máximo.
<FeCabReq><CbteTipo>/                          Si informa opcionales con más de un identificador
                                     1483      23 – Referencia Comercial, no repetir el valor.
<Opcionales><Id><Valor>
                                               Si el tipo de comprobante que está autorizando es
<FeCabReq><CbteTipo>/                          MiPyMEs (FCE), es crédito o débito C, de
                                               anulación, solo se encuentra habilitado asociar un
<CbteAsoc>/                          1486
                                               comprobante de crédito C. Utilizar debito para
                                               anular crédito o utilizar crédito para anular débito
                                               o factura.
<CbteTipo> / <DocTipo> /                       Para comprobantes MiPyMEs (FCE) el documento
                                     1487
<DocNro>                                       del receptor debe ser 80 CUIT.
<FeCabReq><CbteTipo>/                          Si el tipo de comprobante que está autorizando es
                                               MiPyMEs (FCE), Débito o Crédito, el comprobante
<CbteAsoc> / <Tipo> / <PtoVta> /     1488
                                               debe existir autorizado en las bases de esta
<Nro> / <Cuit> / <CbteFch>                     Administración.

<FeCabReq><CbteTipo>/                          Si el tipo de comprobante que está autorizando es
                                     1490      MiPyMEs (FCE), no se encuentra habilitado
<FECAEADetRequest><PeriodoAs
                                               informar PeriodoAsoc.
oc>
<FeCabReq><CbteTipo>/                          Si el comprobante es Debito o Crédito, se deberá
                                               informar de forma obligatoria los campos Fecha
<FECAEADetRequest><CbtesAsoc
                                               Comprobantes Asociados Desde/Hasta, o al menos
>/                                   1491
                                               un comprobante asociado.
<FECAEADetRequest><PeriodoAs
oc>
<FeCabReq><CbteTipo>/                          Si el comprobante es Factura no se deberá
                                     1492      informar los campos Fecha Comprobantes
<FECAEADetRequest><PeriodoAs
                                               Asociados Desde/Hasta
oc>

---

<!-- page 148 -->

                               Código de
        Campo / Grupo                                           Validación
                                 Error
<FECAEADetRequest><PeriodoAs               Si envía estructura PeriodoAsoc es obligatorio
                                 1493
oc><FchDesde>                              enviar FchDesde.
<FECAEADetRequest><PeriodoAs               Si envía estructura PeriodoAsoc es obligatorio
                                 1494
oc><FchHasta>                              enviar FchHasta.
                                           El campo PeriodoAsoc.FchDesde debe
<FECAEADetRequest><PeriodoAs
                                 1495      corresponder a una fecha valida con formato
oc><FchDesde>
                                           YYYYMMDD
                                           El campo PeriodoAsoc.FchHasta debe
<FECAEADetRequest><PeriodoAs
                                 1496      corresponder a una fecha valida con formato
oc><FchHasta>
                                           YYYYMMDD
<FECAEADetRequest><PeriodoAs               Las fechas informadas en PeriodoAsoc deben ser
oc><FchDesde>/                             superiores a 01/01/2006
                                 1497
<FECAEADetRequest><PeriodoAs
oc><FchHasta>
<FECAEADetRequest><PeriodoAs               Las fechas informadas en PeriodoAsoc , FchHasta
oc><FchDesde>/                             debe ser superior o igual a FchDesde.
                                 1498
<FECAEADetRequest><PeriodoAs
oc><FchHasta>
                                           Las fecha informada en PeriodoAsoc.FchHasta
<FECAEADetRequest><PeriodoAs
                                 1499      debe ser anterior o igual a la fecha de emisión del
oc><FchHasta>
                                           comprobante que estamos autorizando
                                           Informar de forma obligatoria la fecha de Emisión
                                           del comprobante asociado si el punto de venta del
<FECAEADetRequest
                                 1502      comprobante asociado es Controlador Fiscal o
><CbtesAsoc><CbteFch>
                                           FactuWeb y el tipo de Comprobante asociado es
                                           Factura, Recibo, Nota de Débito/Nota de Crédito
                                           De informar fecha de Emisión del comprobante
<FECAEADetRequest                          asociado y el punto de venta es Controlador Fiscal
                                 1503
><CbtesAsoc><CbteFch>                      o FactuWeb, la fecha no puede ser posterior al día
                                           de hoy.
<FECAEADetRequest><CbtesAsoc               Si se informan deben tener el siguiente formato
                                 1504
><CbteFch>                                 yyyymmdd.
                                           Si el comprobante es del tipo A (1, 2, 3, 4, 5, 34,
<FECAEADetRequest>/                        39, 60, 63) e intenta informar datos opcionales
                                 1505
<Opcionales><Id>/<CbteTipo>                según Resolución General 3668, los valores
                                           posibles para los identificadores son 5, 61, 62, 7.
<FECAEADetRequest>/                        Si informa Id = 5, el valor ingresado no puede ser
                                           blanco y debe ser alfanumérico de 2 caracteres.
<Opcionales><Id>/                1506

<Opcionales><Valor>

---

<!-- page 149 -->

                          Código de
        Campo / Grupo                                      Validación
                            Error
                                      Si informa Id = 5, el contenido del campo <Valor>
                                      debe corresponder a un código de EXCEPCION
                                      válido comprendido por alguno de los sig:

                                      01 – Locador / Prestador del mismo
<FECAEADetRequest>/
                                      02 – Congresos / Eventos
<Opcionales><Id>/           1507
                                      03 – Operación contemplada en RG 74
<Opcionales><Valor>
                                      04 – Bienes de Cambio

                                      05 – Ropa de trabajo

                                      06 – Intermediario
<FECAEADetRequest>/                   Si informa Id = 61, el valor ingresado no puede ser
                                      blanco y debe ser numérico de 2 caracteres.
<Opcionales><Id>/           1508

<Opcionales><Valor>
<FECAEADetRequest>/                   Si informa Id = 61, el contenido del campo <Valor>
                                      debe corresponder a un código que represente el
<Opcionales><Id>/           1509
                                      tipo de documento del firmante. Ver método
<Opcionales><Valor>                   FEParamGetTiposDoc.

<FECAEADetRequest>/                   Si informa Id = 62, el valor ingresado no puede ser
                                      blanco y debe ser numérico de 11 caracteres como
<Opcionales><Id>/           1510
                                      máximo.
<Opcionales><Valor>
<FECAEADetRequest>/                   Si informa Id = 7, el valor ingresado no puede ser
                                      blanco y debe ser numérico de 2 caracteres.
<Opcionales><Id>/           1511

<Opcionales><Valor>
                                      Si informa Id = 7, el contenido del campo <Valor>
                                      debe corresponder a un código de carácter
                                      firmante válido comprendido por alguno de los sig:
<FECAEADetRequest>/
                                      01 – Titular
<Opcionales><Id>/           1512
                                      02 – Director / Presidente
<Opcionales><Valor>
                                      03 – Apoderado

                                      04 – Empleado
                                      Si el tipo de comprobante que está autorizando es
<FeCabReq><CbteTipo>/                 MiPyMEs (FCE), informa opcionales, el tipo de
                            1513
<Opcionales><Id><Valor>               dato correcto para el código 27 es un
                                      alfanumérico de 3 caracteres.
<FeCabReq><CbteTipo>/       1514      Si el tipo de comprobante que está autorizando es

---

<!-- page 150 -->

                          Código de
        Campo / Grupo                                      Validación
                            Error
                                      MiPyMEs (FCE), informa opcionales y el código es
                                      27, los valores posibles son:

<Opcionales><Id><Valor>               SCA = "TRANSFERENCIA AL SISTEMA DE
                                      CIRCULACION ABIERTA"

                                      ADC = "AGENTE DE DEPOSITO COLECTIVO"
                                      Si el tipo de comprobante que está autorizando es
<FeCabReq><CbteTipo>/                 Factura del tipo MiPyMEs (201, 206, 211), es
                            1515
<Opcionales><Id><Valor>               obligatorio informar <Opcionales> con id = 27. Los
                                      valores posibles son SCA o ADC.
                                      Si el comprobante es del tipo B e intenta informar
<FECAEADetRequest>/                   datos opcionales según Resolución General 4004-
                            1517
<Opcionales><Id>                      E, los valores posibles para los identificadores son
                                      17, 1801, 1802.
                                      Si informa id = 17 (RG 4004-E Locación de
                                      inmuebles destino "casa-habitación"), el valor
<FECAEADetRequest>/                   ingresado no puede ser blanco y debe ser un
                            1518      numérico de 1 carácter:
<Opcionales><Id><Valor>
                                      1 (uno) = facturación a través de intermediario
                                      2 (dos) = facturación directa
                                      Si informa Id = 1801 (RG 4004-E Locación de
<FECAEADetRequest>/                   inmuebles destino "casa-habitación") con un CUIT
                            1519
<Opcionales><Id><Valor>               propietario/locador no repetirlo dentro de la lista
                                      de propietarios/locadores
                                      Si informa Id = 1802 (RG 4004-E Locación de
                                      inmuebles destino "casa-habitación") el valor
<FECAEADetRequest>/                   ingresadono puede ser un blanco y debe ser un
                            1520
<Opcionales><Id><Valor>               alfanumérico de 100 caracteres como máximo que
                                      representa el Nombre y Apellido
                                      propietario/locador.
                                      Si informa id 17 con valor 1 (Intermediario) (RG
                                      4004-E Locación de inmuebles destino
                                      "casahabitación"), deben informarse
<FECAEADetRequest>/                   obligatoriamente los identificadores 1801 y 1802.
                            1521      Si informa id 17 con valor 2 (Directo) (RG 4004-E
<Opcionales><Id><Valor>
                                      Locación de inmuebles destino "casa-habitación"),
                                      pueden no informarse los identificadores 1801,
                                      1802. Solo informarlos cuando hay otro/s
                                      propietarios/locadores
<FECAEADetRequest>/                   Si informa id = 1801 (RG 4004-E Locación de
                            1522      inmuebles destino "casa-habitación"), el valor
<Opcionales><Id><Valor>
                                      ingresado no puede ser blanco y debe

---

<!-- page 151 -->

                              Código de
         Campo / Grupo                                        Validación
                                Error
                                          corresponder al CUIT del propietario/locador.
                                          Numérico de 11 caracteres.
                                          Si informa Id = 1801 (RG 4004-E Locación de
 <FECAEADetRequest>/                      inmuebles destino "casa-habitación"), verificar
                                1523
 <Opcionales><Id><Valor>                  que el número consignado se encuentra en los
                                          padrones de ARCA.
                                          Si informa Id = 1801 (RG 4004-E Locación de
 <FECAEADetRequest>/                      inmuebles destino "casa-habitación") con un CUIT
                                1524
 <Opcionales><Id><Valor>                  propietario/locador no puede ser el mismo que el
                                          emisor del comprobante.
                                          Si informa id 1801 y id 1802 (RG 4004-E Locación
 <FECAEADetRequest>/                      de inmuebles destino "casa-habitación"), la
                                1525
 <Opcionales><Id><Valor>                  cantidad de opcionales con id 1801 y 1802 deben
                                          ser iguales.
                                          Si informa id 1801 y id 1802 (RG 4004-E Locación
 <FECAEADetRequest>/                      de inmuebles destino "casa-habitación"), es
                                1526
 <Opcionales><Id><Valor>                  obligatorio informar el id 17 con valor 1
                                          (Intermediario) o 2 (Directo)
 <FECAEADetRequest> /                     Si informa el campo CanMisMonExt, los valores
                                 820
 <CanMisMonExt>                           posibles son S o N y no debe quedar vacío.
                                          El campo de identificación de la Condición de IVA
 <FECAEADetRequest> /                     del receptor no es un valor permitido. Para mayor
                                 823
 <CondicionIVAReceptorId>                 detalle consular el método
                                          FEParamGetCondicionIvaReceptor.
                                          Campo Condición Frente al IVA del receptor es
                                          obligatorio conforme a lo reglamentado por la
 <FECAEADetRequest> /
                                 826      Resolución General N° 5616. Para mas información
 <CondicionIVAReceptorId>
                                          consular método
                                          FEParamGetCondicionIvaReceptor.




Validaciones NO Excluyentes

                              Código de
            Campo                                             Validación
                               Observ.
                                          El campo DocNro para comprobantes Tipo A
<CbteTipo> / <DocNro>           708       deberá ser un valor registrado y ACTIVO en el
                                          padrón de arca.
<ImpTotConc> / <ImpOpEx> /                El campo “Importe Total” <ImpTotal>, debe ser
<ImpNeto> / <ImpTrib> /         724       igual a la suma de ImpTotConc + ImpNeto +
<ImpIVA> / <ImpTotal>                     ImpOpEx + ImpTrib + ImpIVA

---

<!-- page 152 -->

                                  Código de
             Campo                                                 Validación
                                   Observ.
                                              Margen de error:

                                              Error relativo porcentual deberá ser <= 0.01% o el
                                              error absoluto <=0.01
                                              Debe informarse solo si <Concepto> es igual a 2 ó
FchServHasta                        728
                                              3. En otro caso no corresponde.
                                              Debe ser igual a la sumatoria de la totalidad de los
                                              campos <importe> (dentro de <AlicIVA>)

                                              Margen de error:
<ImpIVA>                            725
                                              Error relativo porcentual deberá ser <= 0.01% o el
                                              error absoluto <=0.01 * cantidad de alícuotas de
                                              IVA ingresadas*
                                              Para comprobantes Tipo A deberá encontrarse
<CbteTipo> / 152<DocTipo> /
                                    1402      registrado en condición activa en el Impuesto al
<DocNro>
                                              Valor Agregado o Responsable Monotributo.
                                              FchServDesde debe informarse solo si Concepto es
<FchServDesde>                      727
                                              igual a 2 o 3. En otro caso no corresponde.
                                              Para comprobantes tipo B o C (CbteDesde igual a
                                              CbteHasta) y DocTipo 80, 86, 87, DocNro deberá
<CbteTipo> / <DocTipo> /                      ser un valor registrado en el padrón de arca. Si
                                    1420
<DocNro>                                      DocTipo es 80 y DocNro es 23000000000 (No
                                              Categorizado) esta validación no se tendrá en
                                              cuenta.
                                              La suma de los campos <BaseImp> en <AlicIva>
                                              debe ser igual al valor ingresado en ImpNeto.
                                              Esta validación no deberá ser tenida en cuenta,
                                              cuando el <CbteTipo> sea 02, 03, 07, 08.

<ImpNeto> / <AlicIva> <BaseImp>     1408
                                              Margen de error:

                                              Error relativo porcentual deberá ser <= 0.01% o el
                                              error absoluto <=0.01 * cantidad de alícuotas de
                                              IVA ingresadas *

FchVtoPago                          1411      Debe ser mayor o igual a la fecha del comprobante.

                                              Debe informarse solo si <Concepto> es igual a 2 ó
FchVtoPago                          729
                                              3. En otro caso no corresponde.
                                              <FchServDesde> no puede ser posterior al campo
<FchServDesde>/ <FchServHasta>      1412
                                              <FchServHasta>.
                                              Debe ser igual a la sumatoria de la totalidad de los
<ImpTrib>                           1406
                                              campos <Importe> (dentro de <Tributos>).

---

<!-- page 153 -->

                                Código de
               Campo                                            Validación
                                 Observ.
                                            Margen de error:

                                            Error relativo porcentual deberá ser <= 0.01% o el
                                            error absoluto <=0.01 * cantidad de tributos *
                                            El CAEA y punto de venta no debe estar informado
CAEA / <PtoVta>                   1424
                                            sin movimientos.
                                            Para comprobantes tipo B, si <DocTipo> es 80 y
<ImpTrib> <DocTipo><DocNro>       1425      <DocNro> es 23000000000 (No Categorizado),
                                            <ImpTrib> debe ser mayor a 0.
<FchServDesde>/                             Si se informan deben tener el siguiente formato
                                  1413
<FchServHasta>/ <FchVtoPago>                yyyymmdd.
<ImpNeto>/                                  Si ImpNeto es mayor a 0, el objeto AlicIva es
                                  1427
<Iva>.<AlicIva>                             obligatorio y no debe ser nulo.

<Auth><Cuit> /
                                            No se encuentra habilitado a emitir comprobantes
<CbteTipo> /                      1429      “A” a la fecha de emisión del comprobante. El
                                            comprobante queda observado.
<CbteFch>
<Auth><Cuit> /
                                            Al momento de emitir el comprobante, debe estar
<CbteTipo> /                      1431
                                            dado de alta en el Impuesto.
<CbteFch>
                                            Si el punto de venta informado no es para
<CbteFchHsGen>                    1442      CONTINGENCIA no informar el campo
                                            <CbteFchHsGen>
                                            El campo <CbteFch> podrá estar comprendido en
                                            el rango N-5 y N+5 siendo N la fecha
<CbteFch>/                                  CbteFchHsGen (contingencia) para Concepto= 01
<CbteFchHsGen>/                   1445      Productos.

<Concepto>                                  - Para Concepto 02, 03 el campo CbteFch debe
                                            estar comprendido en el rango N-10 y N+10
                                            siendo N la fecha CbteFchHsGen (contingencia).
<Auth><Cuit>/                               Según la categorización de las CUITs emisora y
                                  1485      receptora y el monto facturado debe realizar una
<FeCabReq><CbteTipo>/
                                            factura de crédito electrónica MiPyMEs (FCE). Ver
<FECAEDetRequest><DocNro>/                  micrositio.

<FECAEDetRequest><ImpTotal> /
<FECAEDetRequest><MonCotiz>
/ Tope

<DocTipo>/                        1489      Si el tipo de documento del receptor del
                                            comprobante que está autorizando es CUIT (código

---

<!-- page 154 -->

                                Código de
            Campo                                               Validación
                                 Observ.
                                            Tipo de Documento 80) y la CUIT se encuentra
                                            inactiva por haber sido incluida en la consulta de
<DocNro>/
                                            facturas apócrifas, no podrá computarse el crédito
                                            fiscal.
<FECAEADetRequest><Tributos><               Si en la estructura Tributos informa percepciones,
Id>/                                        PeriodoAsoc.FchDesde y PeriodoAsoc.FchHasta
                                            deben corresponder al mismo Mes/Anio
<FECAEADetRequest><PeriodoAs
                                  1500
oc><FchDesde>/

<FECAEADetRequest><PeriodoAs
oc><FchHasta>
                                            Si el comprobante asociado se autorizó de forma
<FECAEADetRequest><CbteFch>/                electrónica y tiene una fecha de emisión posterior
<FECAEADetRequest><CbtesAsoc      1501      a la fecha de emisión del comprobante por el cual
><CbteFch>                                  se está solicitando la autorización, ambos deberán
                                            ser del mismo mes/año.
                                            Para comprobantes Clase “A” y “A con leyenda
                                            operación sujeta a retención”, donde el receptor
                                            del comprobante informado en <DocTipo> y
                                            <DocNro> se encuentra activo en el Impuesto
<CbteTipo> / <DocNro>             1516
                                            Responsable Monotributo, “El crédito fiscal
                                            discriminado en el presente comprobante solo
                                            podrá ser computado a efectos del Procedimiento
                                            permanente de transición al Régimen General.”
                                            Para comprobantes Clase “A” y “A con leyenda
                                            operación sujeta a retención”, se ha detectado que
                                            esta pendiente de presentación el formulario de
                                            habilitación de comprobantes o su fecha de
<CbteTipo> / <DocNro>             814       presentación es anterior a la fecha de alta en IVA.
                                            Para el caso que el comprobante no sea una Nota
                                            de Crédito, se debe proceder a anular la operación
                                            clase “A” y “A con leyenda operación sujeta a
                                            retención” emitida, mediante una Nota de Crédito.
                                            A la fecha de emisión del comprobante, no te
                                            encontrabas habilitado a la emisión de
<CbteTipo> / <DocNro> /                     comprobantes clase “A” / “A con leyenda
                                  815
<FECAEADetRequest><CbteFch>/                operación sujeta a retención”. Tenés que proceder
                                            a emitir la Nota de Crédito, o anular la operación,
                                            según corresponda.
                                            El monto total del comprobante emitido, excede el
<CbteTipo> / <DocNro> /                     límite establecido para la categoría máxima de
                                  816       Monotributo. Por tal motivo, quedarías excluido
<FECAEADetRequest> / ImpTotal
                                            automáticamente teniendo que solicitar el alta de
                                            los tributos (impositivos y de los recursos de la

---

<!-- page 155 -->

                                Código de
            Campo                                               Validación
                                 Observ.
                                            seguridad social) en el régimen general de acuerdo
                                            con tu actividad.

                                            El monto del comprobante emitido, excede el
<CbteTipo> / <DocNro> /                     límite establecido para su categoría de
                                  817
<FECAEADetRequest> / ImpTotal               Monotributo. Tenelo en cuenta para la próxima
                                            recategorización.
                                            El importe de la nota de crédito supera el monto
                                            del comprobante asociado que estás ajustando.
<FECAEADetRequest> /
                                  818       Verificá los montos ingresados y de tratarse de un
ImpTotal / <CbteAsoc>
                                            error, tenés que efectuar el ajuste o anulación de
                                            la operación según corresponda.

<FECAEADetRequest> / <DocNro>     819       La CUIT receptora ingresada no existe.

                                            Si informa el campo MonCotiz, el mismo no podrá
<FECAEADetRequest> /
                                  821       superar en 1 a la cotizacion oficial. Ver Método
<CanMisMonExt>
                                            FEParamGetCotizacion.
<FECAEADetRequest> /                        Si informa MonId = PES, el campo CanMisMonExt
                                  822
<CanMisMonExt>                              no debe informarse o informarse con el valor N.
                                            El campo de identificación de Condición de IVA del
<FECAEADetRequest> /                        receptor no es valido para la clase de comprobante
                                  824
<CondicionIVAReceptorId>                    informado. Para mas detalle consultar el Método:
                                            FEParamGetCondicionIvaReceptor
                                            El campo Condición Frente al IVA del receptor
                                            resultará obligatorio conforme lo reglamentado
<FECAEADetRequest> /
                                  825       por la Resolución General N° 5616. Para mas
<CondicionIVAReceptorId>
                                            información consular método
                                            FEParamGetCondicionIvaReceptor.
                                            La CUIT receptora informada está inactiva o es
<FECAEADetRequest> / <DocNro>     827       inválida. Se bebe emitir una Nota de Crédito o
                                            anular la operación, según corresponda.
                                            La CUIT receptora se encuentra limitada por haber
                                            sido caracterizada como sujeto no confiable en
<FECAEADetRequest> / <DocNro>     828       materia de Seguridad Social. Se bebe emitir una
                                            Nota de Crédito o anular la operación, según
                                            corresponda.
                                            El número de documento informado para el sujeto
                                            receptor corresponde a un sujeto fallecido, sin
<FECAEADetRequest> / <DocNro>     829       sucesión indivisa registrada. Se debe emitir una
                                            Nota de Crédito o anular la operación, según
                                            corresponda.

---

<!-- page 156 -->

Verificaciones que se realizan sobre el elemento <CbtesAsoc>



Validaciones Excluyentes



            Campo                Código de Error                     Validación

                                                   Si envía CbtesAsoc, CbteAsoc es obligatorio y
CbtesAsoc                             800          no debe estar vacío.


                                                   De enviarse el tag CbtesAsoc, CbteAsoc debe
PtoVta                                802
                                                   enviarse con PtoVta mayor a 0 y < a 99999
                                                   De enviarse el tag CbtesAsoc, CbteAsoc debe
Nro                                   803          enviarse con Nro mayor a 0 y menor a
                                                   99999999
                                                   Los comprobantes informados no podrán
Tipo / PtoVta / Nro                   804
                                                   repetirse.
                                                   De enviarse el tag CbtesAsoc, CbteAsoc debe
Tipo                                  805
                                                   enviarse con Tipo mayor a 0
                                                   CbtesAsoc es opcional, solamente podrá
CbteTipo / CbtesAsoc                               informarse si CbteTipo es igual a 1, 2, 3, 6, 7,
                                      807
                                                   8, 12, 13, 51, 52, 53, 63, 64, 201, 202, 203,
                                                   206, 207, 208, 211, 212, 213.
                                                   Si informa Cuit en comprobantes asociados,
                                                   no informar en blanco, el mismo debe ser un
                                                   valor de 11 caracteres numericos. Para
<CbteAsoc><Cuit>                      808
                                                   comprobante del tipo MiPyMEs (FCE) del tipo
                                                   débito o crédito es obligatorio informar el
                                                   campo.
                                                   Para comprobantes MiPyMEs (FCE) 201, 206
                                                   o 211 puede asociarse los comprobantes (91,
                                                   990, 991, 993, 994, 995).

                                                   Para comprobantes MiPyMEs (FCE) A 202 y
CbteTipo / CbtesAsoc                  812          203, puede asociar 201,202 o 203.

                                                   Para comprobantes MiPyMEs (FCE) B 207,
                                                   208 puede asociar 206, 207, 208.

                                                   Para comprobantes MiPyMEs (FCE) C 212,
                                                   213 puede asociarse 211, 212, 213.
                                                   Si intenta informar datos opcionales según
<Opcionales><Id>
                                      813          Resolución General, recordar que en un
                                                   mismo comprobante solo puede informar
                                                   identificadores opcionales para solo 1

---

<!-- page 157 -->

                                                resolución por comprobante.




Validaciones NO Excluyentes



        Campo           Código de Observ.                        Validación

                                            Obligatorio. Deberá ser igual a 1, 2, 3, 04, 05, 34,
                                            39, 60, 63, 88 o 991 si el tipo de comprobante
                                            que se informa es igual a 2 ó 3.

                                            Deberá ser igual a 6, 7, 8, 09, 10, 35, 40, 61, 64 ,88
                                            o 991 si el tipo de comprobante que se informa es
                                            igual a 7 ú 8.


Tipo                          806
                                            Deberá ser igual a 11, 12, 13, 15 si el tipo de
                                            comprobante que informa es igual a 12 o 13

                                            Deberá ser igual a 51, 52, 53, 54 si el tipo de
                                            comprobante que se informa es igual a 52 o 53.

                                            Deberá ser 91, 88, 988, 990, 991, 993, 994, 995,
                                            996, 997 si el tipo de comprobante que se informa
                                            es 1, 6 o 51
                                            Si el punto de venta del comprobante asociado
                                            (campo PtoVta de CbtesAsoc) es electrónico, el
Tipo/ PtoVta / Nro            801           número de comprobante debe obrar en las bases
                                            del organismo para el punto de venta y tipo de
                                            comprobante informado.
<CbteAsoc><Tipo> /
<CbteAsoc><PtoVta> /                        Si informa comprobantes asociados, y sus códigos
<CbteAsoc><Nro>               809           son 91, 88, 988, 990, 991, 993, 994, 995, 996, 997,
                                            los mismos deben encontrarse registrados.

<CbteAsoc><Tipo> /
<CbteAsoc><PtoVta> /                        Si informa comprobantes asociados, y sus códigos
<CbteAsoc><Nro>               810           son 91, 88, 988, 990, 991, 993, 994, 995, 996, 997,
                                            los mismos deben encontrarse confirmados.

                                            Si informa comprobantes asociados y sus códigos
<DocTipo> / <DocNro>                        son 91, 88, 988, 990, 991, 993, 994, 995, 996, 997,
                              811           el receptor del comprobante debe ser igual al
<CbteAsoc><Cuit>
                                            receptor del comprobante asociado.

---

<!-- page 158 -->

Controles que se realizan sobre el elemento <Tributo>



Validaciones Excluyentes




       Campo            Código de Error                             Validación

                                             Obligatorio. Valores permitidos: consultar método
Id                              900
                                             FEParamGetTiposTributos

Desc                            908          Opcional. Debe informarse si <codigo> es igual a 99.

                                             El valor informado debe ser mayor o igual a 0.
Importe                         907          El campo Importe de Tributos soporta 13 números para
                                             la parte entera y 2 para los decimales.
                                             El campo BaseImp en Tributo es obligatorio, mayor o
                                             igual 0 cero.
BaseImp                         905
                                             El campo BaseImp de Tributos soporta 13 números para
                                             la parte entera y 2 para los decimales.
                                             El campo Alic en Tributo es obligatorio, mayor o igual 0
                                             cero.
Alic                            906
                                             El campo Alic de Tributos soporta 3 números para la
                                             parte entera y 2 para los decimales.




Controles que se realizan sobre el elemento <IVA>



Validaciones Excluyentes



          Campo            Código de Error                           Validación

                                             Consultar el método FEParamGetTiposIva. Es opcional
 Id                             1000
                                             para comprobantes 2, 3, 7, 8.
                                             El campo Id en AlicIVA no debe repetirse. Deberá
 Id                             1003
                                             totalizarse por alícuota.
                                             El campo Importe en AlicIVA es obligatorio , mayor o
 Importe                        1008
                                             igual 0 cero.

---

<!-- page 159 -->

                                             El campo Importe de AlicIva soporta 13 números para la
                                             parte entera y 2 para los decimales.
                                             El campo BaseImp en AlicIVA es obligatorio y debe ser
                                             mayor a 0 cero. Excepto para comprobantes 2, 3, 7, 8
                                             que puede ser cero o no ser informado.
 BaseImp                      1009

                                             El campo BaseImp de AlicIva soporta 13 números para
                                             la parte entera y 2 para los decimales.


Validaciones NO Excluyentes


                              Código de
         Campo                                                       Validación
                               Observ.
                                              Los importes informados en AlicIVA no se corresponden
                                              con los porcentajes. Excepto para comprobantes 2, 3, 7,
                                              8 que puede ser cero o no ser informado.
 Importe / AlicIva /
                                1006
 BaseImp
                                              Margen de error:

                                              Error relativo porcentual deberá ser <= 0.01% o el error
                                              absoluto <=0.01




Controles que se realizan sobre el elemento <Opcionales>



Validaciones Excluyentes




        Campo              Código de Error                            Validación

                                               El campo Id en Opcionales es obligatorio y debe ser
Id                              1100
                                               igual a 2 (Régimen de Promoción Industrial).
                                               El campo Id en Opcionales es obligatorio y no debe
Id                              1101
                                               repetirse.

Valor                           1105           El campo Valor en Opcionales es obligatorio.

<Opcionales><Opcional                          Si envía Opcionales, Opcional, Id y Valor son
                                1103
><Id><Valor>                                   obligatorios.
Valor                           1104           Si selecciona Id = 2 el valor ingresado debe ser un

---

<!-- page 160 -->

        Campo              Código de Error                             Validación

                                                numérico de 8 (ocho) dígitos mayor o igual a 0 (cero).




Validaciones NO Excluyentes



                           Código de
        Campo                                                        Validación
                            Observ.
                                             Si Id = 2 y el comprobante corresponde a una actividad
                                             alcanzada por el beneficio de Promoción Industrial en el
                                             campo <Valor> se deberá informar el número
Valor                         1106           identificatorio del proyecto (el mismo deberá corresponder
                                             a la cuit emisora del comprobante), si no corresponde a
                                             una actividad alcanzada por el beneficio el campo <Valor>
                                             deberá ser 0 (cero).




Controles que se realizan sobre el elemento <Actividades>



Validaciones Excluyentes



 <FeCAEARegInfReq><Actividades><Actividad>                               Si envía estructura de Actividades,
                                                               16000
                                                                         Actividad es obligatorio enviarlo.
                                                                         Si envía estructura de Actividades,
 <FeCAEARegInfReq><Actividades><Actividad><Id>                 16001     Actividad es obligatorio enviarlo y no
                                                                         debe estar vacío.
                                                                         El identificador de actividad
                                                                         informado tiene que ser una de las
 <FeCAEARegInfReq><Actividades><Actividad><Id>                 16002
                                                                         actividades habilitadas. Consultar
                                                                         método FEParamGetActividades.
                                                                         De enviarse el tag Actividades, las
 <FeCAEARegInfReq><Actividades><Actividad><Id>                 16003
                                                                         actividades no deben repetirse.
                                                                         De enviarse actividades, las mismas
                                                                         no deben corresponder a distintos
 <FeCAEARegInfReq><Actividades><Actividad><Id>                 16004     grupos según RG. Es decir, si informa
                                                                         actividades Cárnicas, no pueden estar
                                                                         combinadas con actividades

---

<!-- page 161 -->

                                                                    Harineras, de Tabaco, etc.
                                                                    De enviarse actividades, las mismas
                                                                    deben encontrarse activas para el
 <FeCAEARegInfReq><Actividades><Actividad><Id>             16005
                                                                    emisor del comprobante. Ver método
                                                                    FEParamGetActividades.
                                                                    De enviarse actividades
                                                                    pertenecientes al grupo de
 <FeCAEARegInfReq><Actividades><Actividad><Id> /                    actividades Cárnicas, las mismas
                                                           16006
 <Concepto>                                                         deben enviarse con comprobantes
                                                                    con Concepto del tipo Producto o
                                                                    Productos y Servicios.




Controles que se realizan sobre el elemento <Actividades> y <CbtesAsoc>

Validaciones Excluyentes



                                                                    Si las actividades informadas
 <FeCAEARegInfReq><Actividades><Actividad><Id>                      corresponden a actividades Cárnicas,
                                                           16007
 /<CbtesAsoc><CbteAsoc><Tipo>                                       informar remito asociado 995 -
                                                                    Remito Electrónico Cárnico.
                                                                    Si las actividades informadas
                                                                    corresponden a actividades Harinas,
                                                                    informar remito asociado 993 -
 <FeCAEARegInfReq><Actividades><Actividad><Id>
                                                           16008    Remito Electrónico Harinero -
 /<CbtesAsoc><CbteAsoc><Tipo>                                       Automotor o

                                                                    994 - Remito Electrónico Harinero -
                                                                    Ferroviario.
                                                                    Si las actividades informadas
 <FeCAEARegInfReq><Actividades><Actividad><Id>                      corresponden a actividades Tabaco
                                                           16009    en Hebras, informar remito asociado
 /<CbtesAsoc><CbteAsoc><Tipo>                                       88 - Remito Electrónico de Tabaco
                                                                    Acondicionado.

 <FeCAEARegInfReq><Actividades><Actividad><Id>                      Si informa remito 995 - Remito
                                                           16010    Electrónico Cárnico, es obligatorio
 /<CbtesAsoc><CbteAsoc><Tipo>                                       informar una actividad Cárnica.
                                                                    Si informa remito 993 - Remito
                                                                    Electrónico Harinero - Automotor o
 <FeCAEARegInfReq><Actividades><Actividad><Id>
                                                           16011    994 - Remito Electrónico Harinero –
 /<CbtesAsoc><CbteAsoc><Tipo>
                                                                    Ferroviario, es obligatgorio informar
                                                                    una actividad Harinera.

---

<!-- page 162 -->

                                                                      Si las actividades informadas
 <FeCAEARegInfReq><Actividades><Actividad><Id>                        corresponden a actividades Cárnicas,
                                                             16007
 /<CbtesAsoc><CbteAsoc><Tipo>                                         informar remito asociado 995 -
                                                                      Remito Electrónico Cárnico.
                                                                      Si informa remito 88 - Remito
                                                                      Electrónico de Tabaco
 <FeCAEARegInfReq><Actividades><Actividad><Id>                        Acondicionado., es obligatorio
                                                             16012
 /<CbtesAsoc><CbteAsoc><Tipo>                                         informar una actividad
                                                                      correspondiente a Tabaco
                                                                      Acondicionado.

 <FeCAEARegInfReq><Actividades><Actividad><Id>                        Si informa actividades indicadas en
                                                             16013    la RG, es obligatorio informar
 /<CbtesAsoc><CbteAsoc                                                comprobantes asociados.
                                                                      Si informa comprobantes asociados,
 <CbteAsoc><Tipo> / <CbteAsoc><PtoVta> /                              y sus códigos corresponden a 91, 88,
 <CbteAsoc><Nro>                                                      988, 990, 991, 993, 994, 995, 996,
                                                             16014
                                                                      997, los mismos no deben
                                                                      encontrarse asociado a otro
                                                                      comprobante.




Operatoria ante errores


Metodología sugerida ante el rechazo de un requerimiento con múltiples comprobantes:

Suponiendo que se envían 100 comprobantes en un request y el mismo es de Facturas A,
punto de venta 1 y los comprobantes son desde el número 51 al 150, se nos plantean 3
situaciones.



      Aceptación total: donde, cada uno de los 100 comprobantes fue aprobado. El campo
       Resultado será igual A

      Rechazo total: se puede dar por dos grandes causas, una por problemas del emisor
       y/o inconsistencia en la cabecera, y otra por el rechazo de cada uno de los 100
       comprobantes. En el primer caso el response contendrá solamente en el tag Errors
       con todas las causas involucradas; en el segundo caso se incluirá el tag FeCabResp,
       FeDetResp y Observaciones o Errors con el motivo de rechazo de cada uno de los
       comprobantes. El campo Resultado será igual a R.

      Rechazo parcial: se da cuando alguno de los comprobantes incluidos en el request es
       rechazado. A modo de ejemplo y con los parámetros antes descriptos, se aprueban
       los comprobantes del 51 al 100, 101 saldrá rechazado y del 102 al 150 saldrá como no

---

<!-- page 163 -->

        procesado; esto se debe a que como debe existir correlatividad numérica y de fecha,
        ante una inconsistencia los comprobantes subsiguientes también se rechazaran. Si se
        diese este caso, y para proseguir con la autorización de comprobantes se deberá
        subsanar los errores del comprobante 102 y así enviar un nuevo request. El campo
        Resultado será igual a P.




Operatoria con errores de comunicación:



En el diseño del WsfeV1 se ha previsto que dada la complejidad actual de las comunicaciones-
pueden ocurrir interrupciones en la comunicación entre el cliente y el WsfeV1 básicamente, el
problema podría resumirse al siguiente escenario: el cliente envía una solicitud de informar
comprobantes con CAEA y se queda esperando una respuesta que no llega, hasta que
transcurrido algún tiempo, se produce una condición de time-out.

En ese caso, el usuario no sabrá si la solicitud le llegó al WsfeV1 y fue procesado fallando la
comunicación durante el retorno, o bien si la falla ocurrió durante el envío de la solicitud y
simplemente WsfeV1 nunca la recibió.

En el segundo caso, con simplemente enviar la misma solicitud todo quedaría resuelto, pero en
el primer caso, si el cliente envía nuevamente la misma solicitud para la/s misma/s factura,
WsfeV1 devolvería un error de consecutividad puesto que en la base de datos de arca ese
comprobante ya figura como emitido.

Para estos casos, se utiliza el método FECompConsultar, que dado el tipo de comprobante,
punto de venta y numero de comprobante, retorna toda la información enviada en el
método de registración de comprobantes con CAEA (FECAEARegInformativo) más el
resultado (A: Aprobado), tipo de emisión (en este caso CAEA), fecha de vencimiento, fecha de
proceso y de corresponder las observaciones realizadas al comprobante.

El WsfeV1 también ofrece un método para consultar el último comprobante autorizado
(FECompUltimoAutorizado) para un determinado tipo de comprobante y punto de venta.



Operatoria ante errores, Ejemplos


Se envía un request informando una Factura A. La totalidad del comprobante es No Gravado.
Sin errores.




REQUEST

---

<!-- page 164 -->

<soapenv:Envelope
xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
xmlns:ar="http://ar.gov.afip.dif.FEV1/">
   <soapenv:Header/>
   <soapenv:Body>
       <ar:FECAEARegInformativo>
          <ar:Auth>
             <ar:Token>PD…</ar:Token>
             <ar:Sign>IT…</ar:Sign>
             <ar:Cuit>23000000004</ar:Cuit>
          </ar:Auth>
          <ar:FeCAEARegInfReq>
             <ar:FeCabReq>
                <ar:CantReg>1</ar:CantReg>
                <ar:PtoVta>9800</ar:PtoVta>
                <ar:CbteTipo>1</ar:CbteTipo>
             </ar:FeCabReq>
             <ar:FeDetReq>
                <ar:FECAEADetRequest>
                    <ar:Concepto>1</ar:Concepto>
                    <ar:DocTipo>80</ar:DocTipo>
                    <ar:DocNro>30000000007</ar:DocNro>
                    <ar:CbteDesde>33</ar:CbteDesde>
                    <ar:CbteHasta>33</ar:CbteHasta>
                    <ar:CbteFch>20110211</ar:CbteFch>
                    <ar:ImpTotal>100.00</ar:ImpTotal>
                    <ar:ImpTotConc>100.00</ar:ImpTotConc>
                    <ar:ImpNeto>0</ar:ImpNeto>
                    <ar:ImpOpEx>0.00</ar:ImpOpEx>
                    <ar:ImpIva>0</ar:ImpIva>
                    <ar:ImpTrib>0</ar:ImpTrib>
                    <ar:MonId>PES</ar:MonId>
                    <ar:MonCotiz>1</ar:MonCotiz>
                    <ar:CondicionIVAReceptorId>1</ar:CondicionIVARecep-
torId>
                    <ar:CAEA>21064126523746</ar:CAEA>
                </ar:FECAEADetRequest>
             </ar:FeDetReq>
          </ar:FeCAEARegInfReq>
       </ar:FECAEARegInformativo>
   </soapenv:Body>
</soapenv:Envelope>


RESPONSE

<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
xmlns:xsd="http://www.w3.org/2001/XMLSchema">
   <soap:Body>
      <FECAEARegInformativoResponse
xmlns="http://ar.gov.afip.dif.FEV1/">
         <FECAEARegInformativoResult>
            <FeCabResp>
               <Cuit>23000000004</Cuit>
               <PtoVta>9800</PtoVta>
               <CbteTipo>1</CbteTipo>
               <FchProceso>20110306</FchProceso>

---

<!-- page 165 -->

                <CantReg>1</CantReg>
                <Resultado>A</Resultado>
                <Reproceso>N</Reproceso>
            </FeCabResp>
            <FeDetResp>
                <FECAEADetResponse>
                   <Concepto>1</Concepto>
                   <DocTipo>80</DocTipo>
                   <DocNro>30000000007</DocNro>
                   <CbteDesde>33</CbteDesde>
                   <CbteHasta>33</CbteHasta>
                   <CbteFch>20110211</CbteFch>
                   <Resultado>A</Resultado>
                   <CAEA>21064126523746</CAEA>
                </FECAEADetResponse>
            </FeDetResp>
         </FECAEARegInformativoResult>
      </FECAEARegInformativoResponse>
   </soap:Body>
</soap:Envelope>


Informa una Factura A. La totalidad del comprobante es No Gravado, donde no se supera la
totalidad de las validaciones de la CUIT emisora.


REQUEST

<soapenv:Envelope
xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
xmlns:ar="http://ar.gov.afip.dif.FEV1/">
   <soapenv:Header/>
   <soapenv:Body>
      <ar:FECAEARegInformativo>
         <ar:Auth>
            <ar:Token>PD…</ar:Token>
            <ar:Sign>IT…</ar:Sign>
            <ar:Cuit>23000000000</ar:Cuit> CUIT no supera las
validaciones del ticket de acceso
         </ar:Auth>
         <ar:FeCAEARegInfReq>
            <ar:FeCabReq>
               <ar:CantReg>1</ar:CantReg>
               <ar:PtoVta>9800</ar:PtoVta>
               <ar:CbteTipo>1</ar:CbteTipo>
            </ar:FeCabReq>
            <ar:FeDetReq>
               <ar:FECAEADetRequest>
                   <ar:Concepto>1</ar:Concepto>
                   <ar:DocTipo>80</ar:DocTipo>
                   <ar:DocNro>30000000007</ar:DocNro>
                   <ar:CbteDesde>34</ar:CbteDesde>
                   <ar:CbteHasta>34</ar:CbteHasta>
                   <ar:CbteFch>20110211</ar:CbteFch>
                   <ar:ImpTotal>100.00</ar:ImpTotal>
                   <ar:ImpTotConc>100.00</ar:ImpTotConc>
                   <ar:ImpNeto>0</ar:ImpNeto>
                   <ar:ImpOpEx>0.00</ar:ImpOpEx>

---

<!-- page 166 -->

                       <ar:ImpIva>0</ar:ImpIva>
                       <ar:ImpTrib>0</ar:ImpTrib>
                       <ar:MonId>PES</ar:MonId>
                       <ar:MonCotiz>1</ar:MonCotiz>
                       <ar:CondicionIVAReceptorId>1</ar:CondicionIVARecep-
torId>
                   <ar:CAEA>21064126523746</ar:CAEA>
               </ar:FECAEADetRequest>
            </ar:FeDetReq>
         </ar:FeCAEARegInfReq>
      </ar:FECAEARegInformativo>
   </soapenv:Body>
</soapenv:Envelope>


RESPONSE

<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
xmlns:xsd="http://www.w3.org/2001/XMLSchema">
   <soap:Body>
      <FECAEARegInformativoResponse
xmlns="http://ar.gov.afip.dif.FEV1/">
         <FECAEARegInformativoResult>
            <Errors>  ERROR
                <Err>
                   <Code>600</Code>
                   <Msg>ValidacionDeToken: No apareció CUIT en lista de
relaciones: 23000000000</Msg>
                </Err>
            </Errors>
         </FECAEARegInformativoResult>
      </FECAEARegInformativoResponse>
   </soap:Body>
</soap:Envelope>




Informa una Factura A, con error en la cabecera (FeCabReq) del comprobante, tipo de
comprobante inválido. Genera un Rechazo del comprobante.


REQUEST

<soapenv:Envelope
xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
xmlns:ar="http://ar.gov.afip.dif.FEV1/">
   <soapenv:Header/>
   <soapenv:Body>
      <ar:FECAEARegInformativo>
         <ar:Auth>
            <ar:Token>PD..</ar:Token>
            <ar:Sign>IT…</ar:Sign>
            <ar:Cuit>23000000004</ar:Cuit>
         </ar:Auth>
         <ar:FeCAEARegInfReq>
            <ar:FeCabReq>

---

<!-- page 167 -->

               <ar:CantReg>1</ar:CantReg>
               <ar:PtoVta>9800</ar:PtoVta>
               <ar:CbteTipo>0</ar:CbteTipo>    Tipo de Comprobante
Inválido
            </ar:FeCabReq>
            <ar:FeDetReq>
               <ar:FECAEADetRequest>
                  <ar:Concepto>1</ar:Concepto>
                  <ar:DocTipo>80</ar:DocTipo>
                  <ar:DocNro>30000000007</ar:DocNro>
                  <ar:CbteDesde>34</ar:CbteDesde>
                  <ar:CbteHasta>34</ar:CbteHasta>
                  <ar:CbteFch>20110211</ar:CbteFch>
                  <ar:ImpTotal>100.00</ar:ImpTotal>
                  <ar:ImpTotConc>100.00</ar:ImpTotConc>
                  <ar:ImpNeto>0</ar:ImpNeto>
                  <ar:ImpOpEx>0.00</ar:ImpOpEx>
                  <ar:ImpIva>0</ar:ImpIva>
                  <ar:ImpTrib>0</ar:ImpTrib>
                  <ar:MonId>PES</ar:MonId>
                  <ar:MonCotiz>1</ar:MonCotiz>
                  <ar:CondicionIVAReceptorId>1</ar:CondicionIVARecep-
torId>
                   <ar:CAEA>21064126523746</ar:CAEA>
               </ar:FECAEADetRequest>
            </ar:FeDetReq>
         </ar:FeCAEARegInfReq>
      </ar:FECAEARegInformativo>
   </soapenv:Body>
</soapenv:Envelope>


RESPONSE

<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
xmlns:xsd="http://www.w3.org/2001/XMLSchema">
   <soap:Body>
      <FECAEARegInformativoResponse
xmlns="http://ar.gov.afip.dif.FEV1/">
         <FECAEARegInformativoResult>
            <FeCabResp>
               <Cuit>23000000004</Cuit>
               <PtoVta>9800</PtoVta>
               <CbteTipo>0</CbteTipo>
               <FchProceso>20110306</FchProceso>
               <CantReg>1</CantReg>
               <Resultado>R</Resultado>  Rechazo
               <Reproceso>N</Reproceso>
            </FeCabResp>
            <FeDetResp>
               <FECAEADetResponse>
                  <Concepto>1</Concepto>
                  <DocTipo>80</DocTipo>
                  <DocNro>30000000007</DocNro>
                  <CbteDesde>34</CbteDesde>
                  <CbteHasta>34</CbteHasta>
                  <CbteFch>20110211</CbteFch>
                  <Resultado>R</Resultado>

---

<!-- page 168 -->

                   <CAEA>21064126523746</CAEA>
                </FECAEADetResponse>
            </FeDetResp>
            <Errors>                    Detalle del error
                <Err>
                   <Code>700</Code>
                   <Msg>Campo CbteTipo no se corresponde con alguno de
los habilitados 1, 2 ,3, 6, 7 u 8.</Msg>
                </Err>
            </Errors>
         </FECAEARegInformativoResult>
      </FECAEARegInformativoResponse>
   </soap:Body>
</soap:Envelope>


Informa una Factura A, con error en el detalle (FeDetReq) del comprobante tipo de concepto
inválido. Genera un Rechazo del comprobante
REQUEST

<soapenv:Envelope
xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
xmlns:ar="http://ar.gov.afip.dif.FEV1/">
   <soapenv:Header/>
   <soapenv:Body>
       <ar:FECAEARegInformativo>
          <ar:Auth>
             <ar:Token>PD..</ar:Token>
             <ar:Sign>IT…</ar:Sign>
             <ar:Cuit>23000000004</ar:Cuit>
          </ar:Auth>
          <ar:FeCAEARegInfReq>
             <ar:FeCabReq>
                <ar:CantReg>1</ar:CantReg>
                <ar:PtoVta>9800</ar:PtoVta>
                <ar:CbteTipo>1</ar:CbteTipo>
             </ar:FeCabReq>
             <ar:FeDetReq>
                <ar:FECAEADetRequest>
                    <ar:Concepto>4</ar:Concepto>  4 valor no permitido
                    <ar:DocTipo>80</ar:DocTipo>
                    <ar:DocNro>30000000007</ar:DocNro>
                    <ar:CbteDesde>34</ar:CbteDesde>
                    <ar:CbteHasta>34</ar:CbteHasta>
                    <ar:CbteFch>20110211</ar:CbteFch>
                    <ar:ImpTotal>100.00</ar:ImpTotal>
                    <ar:ImpTotConc>100.00</ar:ImpTotConc>
                    <ar:ImpNeto>0</ar:ImpNeto>
                    <ar:ImpOpEx>0.00</ar:ImpOpEx>
                    <ar:ImpIva>0</ar:ImpIva>
                    <ar:ImpTrib>0</ar:ImpTrib>
                    <ar:MonId>PES</ar:MonId>
                    <ar:MonCotiz>1</ar:MonCotiz>
                    <ar:CondicionIVAReceptorId>1</ar:CondicionIVARecep-
torId>
                    <ar:CAEA>21064126523746</ar:CAEA>
                </ar:FECAEADetRequest>

---

<!-- page 169 -->

            </ar:FeDetReq>
         </ar:FeCAEARegInfReq>
      </ar:FECAEARegInformativo>
   </soapenv:Body>
</soapenv:Envelope>



RESPONSE

<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
xmlns:xsd="http://www.w3.org/2001/XMLSchema">
   <soap:Body>
      <FECAEARegInformativoResponse
xmlns="http://ar.gov.afip.dif.FEV1/">
         <FECAEARegInformativoResult>
            <FeCabResp>
                <Cuit>23000000004</Cuit>
                <PtoVta>9800</PtoVta>
                <CbteTipo>1</CbteTipo>
                <FchProceso>20110306</FchProceso>
                <CantReg>1</CantReg>
                <Resultado>R</Resultado>  Rechazo
                <Reproceso>N</Reproceso>
            </FeCabResp>
            <FeDetResp>
                <FECAEADetResponse>
                   <Concepto>4</Concepto>
                   <DocTipo>80</DocTipo>
                   <DocNro>30000000007</DocNro>
                   <CbteDesde>34</CbteDesde>
                   <CbteHasta>34</CbteHasta>
                   <CbteFch>20110211</CbteFch>
                   <Resultado>R</Resultado>
                   <Observaciones>  Detalle de la causa del rechazo
                      <Obs>
                         <Code>713</Code>
                         <Msg>El campo Concepto es obligatorio y
debe corresponder con algún valor devuelto por el método
FEParamGetTiposConcepto</Msg>
                      </Obs>
                   </Observaciones>
                   <CAEA>21064126523746</CAEA>
                </FECAEADetResponse>
            </FeDetResp>
         </FECAEARegInformativoResult>
      </FECAEARegInformativoResponse>
   </soap:Body>
</soap:Envelope>


Informa una Factura A, con error en el detalle del comprobante (FeDetReq) que no supera
alguna de las validaciones No Excluyentes. Genera una Aprobación del comprobante con
Observaciones.
REQUEST

---

<!-- page 170 -->

<soapenv:Envelope
xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
xmlns:ar="http://ar.gov.afip.dif.FEV1/">
   <soapenv:Header/>
   <soapenv:Body>
       <ar:FECAEARegInformativo>
          <ar:Auth>
             <ar:Token>PD..</ar:Token>
             <ar:Sign>IT…</ar:Sign>
             <ar:Cuit>23000000004</ar:Cuit>
          </ar:Auth>
          <ar:FeCAEARegInfReq>
             <ar:FeCabReq>
                <ar:CantReg>1</ar:CantReg>
                <ar:PtoVta>9800</ar:PtoVta>
                <ar:CbteTipo>1</ar:CbteTipo>
             </ar:FeCabReq>
             <ar:FeDetReq>
                <ar:FECAEADetRequest>
                    <ar:Concepto>1</ar:Concepto>
                    <ar:DocTipo>80</ar:DocTipo>
                    <ar:DocNro>30000000007</ar:DocNro>
                    <ar:CbteDesde>34</ar:CbteDesde>
                    <ar:CbteHasta>34</ar:CbteHasta>
                    <ar:CbteFch>20110211</ar:CbteFch>
                    <ar:ImpTotal>101.00</ar:ImpTotal>  Importe total
incorrecto
                    <ar:ImpTotConc>100.00</ar:ImpTotConc>
                    <ar:ImpNeto>0</ar:ImpNeto>
                    <ar:ImpOpEx>0.00</ar:ImpOpEx>
                    <ar:ImpIva>0</ar:ImpIva>
                    <ar:ImpTrib>0</ar:ImpTrib>
                    <ar:MonId>PES</ar:MonId>
                    <ar:MonCotiz>1</ar:MonCotiz>
                    <ar:CondicionIVAReceptorId>1</ar:CondicionIVARecep-
torId>
                    <ar:CAEA>21064126523746</ar:CAEA>
                </ar:FECAEADetRequest>
             </ar:FeDetReq>
          </ar:FeCAEARegInfReq>
       </ar:FECAEARegInformativo>
   </soapenv:Body>
</soapenv:Envelope>


RESPONSE

<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
xmlns:xsd="http://www.w3.org/2001/XMLSchema">
   <soap:Body>
      <FECAEARegInformativoResponse
xmlns="http://ar.gov.afip.dif.FEV1/">
         <FECAEARegInformativoResult>
            <FeCabResp>
               <Cuit>23000000004</Cuit>
               <PtoVta>9800</PtoVta>
               <CbteTipo>1</CbteTipo>
               <FchProceso>20110306</FchProceso>

---

<!-- page 171 -->

                <CantReg>1</CantReg>
                <Resultado>A</Resultado>  Aprobado
                <Reproceso>N</Reproceso>
            </FeCabResp>
            <FeDetResp>
                <FECAEADetResponse>
                   <Concepto>1</Concepto>
                   <DocTipo>80</DocTipo>
                   <DocNro>30000000007</DocNro>
                   <CbteDesde>34</CbteDesde>
                   <CbteHasta>34</CbteHasta>
                   <CbteFch>20110211</CbteFch>
                   <Resultado>A</Resultado>
                   <Observaciones>             Con Observaciones
                      <Obs>
                         <Code>724</Code>
                         <Msg>El campo 'Importe Total' ImpTotal, debe
ser igual a la suma de ImpTotConc + ImpNeto + ImpOpEx + ImpTrib +
ImpIVA.</Msg>
                      </Obs>
                   </Observaciones>
                   <CAEA>21064126523746</CAEA>
                </FECAEADetResponse>
            </FeDetResp>
         </FECAEARegInformativoResult>
      </FECAEARegInformativoResponse>
   </soap:Body>
</soap:Envelope>


Se envía un Request con tres Facturas A, que superan la totalidad de las validaciones. Genera
una aprobación total de la solicitud.


REQUEST

<soapenv:Envelope
xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
xmlns:ar="http://ar.gov.afip.dif.FEV1/">
   <soapenv:Header/>
   <soapenv:Body>
      <ar:FECAEARegInformativo>
         <ar:Auth>
            <ar:Token>PD…</ar:Token>
            <ar:Sign>jd..</ar:Sign>
            <ar:Cuit>23000000004</ar:Cuit>
         </ar:Auth>
         <ar:FeCAEARegInfReq>
            <ar:FeCabReq>
               <ar:CantReg>3</ar:CantReg>
               <ar:PtoVta>9800</ar:PtoVta>
               <ar:CbteTipo>1</ar:CbteTipo>
            </ar:FeCabReq>
            <ar:FeDetReq>
               <ar:FECAEADetRequest>
                   <ar:Concepto>1</ar:Concepto>
                   <ar:DocTipo>80</ar:DocTipo>
                   <ar:DocNro>30000000007</ar:DocNro>

---

<!-- page 172 -->

            <ar:CbteDesde>35</ar:CbteDesde>
            <ar:CbteHasta>35</ar:CbteHasta>
            <ar:CbteFch>20110211</ar:CbteFch>
            <ar:ImpTotal>200.00</ar:ImpTotal>
            <ar:ImpTotConc>100.00</ar:ImpTotConc>
            <ar:ImpNeto>0</ar:ImpNeto>
            <ar:ImpOpEx>100.00</ar:ImpOpEx>
            <ar:ImpIva>0</ar:ImpIva>
            <ar:ImpTrib>0</ar:ImpTrib>
            <ar:MonId>PES</ar:MonId>
            <ar:MonCotiz>1</ar:MonCotiz>
            <ar:CondicionIVAReceptorId>1</ar:CondicionIVARecep-
torId>
            <ar:CAEA>21064126523746</ar:CAEA>
         </ar:FECAEADetRequest>
         <ar:FECAEADetRequest>
            <ar:Concepto>1</ar:Concepto>
            <ar:DocTipo>80</ar:DocTipo>
            <ar:DocNro>30000000007</ar:DocNro>
            <ar:CbteDesde>36</ar:CbteDesde>
            <ar:CbteHasta>36</ar:CbteHasta>
            <ar:CbteFch>20110211</ar:CbteFch>
            <ar:ImpTotal>101.00</ar:ImpTotal>
            <ar:ImpTotConc>100.00</ar:ImpTotConc>
            <ar:ImpNeto>0</ar:ImpNeto>
            <ar:ImpOpEx>0.00</ar:ImpOpEx>
            <ar:ImpIva>0</ar:ImpIva>
            <ar:ImpTrib>1</ar:ImpTrib>
            <ar:MonId>PES</ar:MonId>
            <ar:MonCotiz>1</ar:MonCotiz>
            <ar:Tributos>
               <ar:Tributo>
                  <ar:Id>99</ar:Id>
                  <ar:Desc>Otro tributo</ar:Desc>
                  <ar:BaseImp>100</ar:BaseImp>
                  <ar:Alic>1</ar:Alic>
                  <ar:Importe>1</ar:Importe>
               </ar:Tributo>
            </ar:Tributos>
            <ar:CAEA>21064126523746</ar:CAEA>
         </ar:FECAEADetRequest>
         <ar:FECAEADetRequest>
            <ar:Concepto>1</ar:Concepto>
            <ar:DocTipo>80</ar:DocTipo>
            <ar:DocNro>30000000007</ar:DocNro>
            <ar:CbteDesde>37</ar:CbteDesde>
            <ar:CbteHasta>37</ar:CbteHasta>
            <ar:CbteFch>20110211</ar:CbteFch>
            <ar:ImpTotal>100.00</ar:ImpTotal>
            <ar:ImpTotConc>0.00</ar:ImpTotConc>
            <ar:ImpNeto>0</ar:ImpNeto>
            <ar:ImpOpEx>100.00</ar:ImpOpEx>
            <ar:ImpIva>0</ar:ImpIva>
            <ar:ImpTrib>0</ar:ImpTrib>
            <ar:MonId>PES</ar:MonId>
            <ar:MonCotiz>1</ar:MonCotiz>
            <ar:CAEA>21064126523746</ar:CAEA>
         </ar:FECAEADetRequest>

---

<!-- page 173 -->

            </ar:FeDetReq>
         </ar:FeCAEARegInfReq>
      </ar:FECAEARegInformativo>
   </soapenv:Body>
</soapenv:Envelope>



RESPONSE


<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
xmlns:xsd="http://www.w3.org/2001/XMLSchema">
   <soap:Body>
      <FECAEARegInformativoResponse
xmlns="http://ar.gov.afip.dif.FEV1/">
         <FECAEARegInformativoResult>
            <FeCabResp>
               <Cuit>23000000004</Cuit>
               <PtoVta>9800</PtoVta>
               <CbteTipo>1</CbteTipo>
               <FchProceso>20110308</FchProceso>
               <CantReg>3</CantReg>
               <Resultado>A</Resultado>  Aprobación total del envío
               <Reproceso>N</Reproceso>
            </FeCabResp>
            <FeDetResp>
               <FECAEADetResponse>
                  <Concepto>1</Concepto>
                  <DocTipo>80</DocTipo>
                  <DocNro>30000000007</DocNro>
                  <CbteDesde>35</CbteDesde>
                  <CbteHasta>35</CbteHasta>
                  <CbteFch>20110211</CbteFch>
                  <Resultado>A</Resultado>  Aprobación del comprob.
                  <CAEA>21064126523746</CAEA>
               </FECAEADetResponse>
               <FECAEADetResponse>
                  <Concepto>1</Concepto>
                  <DocTipo>80</DocTipo>
                  <DocNro>30000000007</DocNro>
                  <CbteDesde>36</CbteDesde>
                  <CbteHasta>36</CbteHasta>
                  <CbteFch>20110211</CbteFch>
                  <Resultado>A</Resultado>  Aprobación del comprob.
                  <CAEA>21064126523746</CAEA>
               </FECAEADetResponse>
               <FECAEADetResponse>
                  <Concepto>1</Concepto>
                  <DocTipo>80</DocTipo>
                  <DocNro>30000000007</DocNro>
                  <CbteDesde>36</CbteDesde>
                  <CbteHasta>36</CbteHasta>
                  <CbteFch>20110211</CbteFch>
                  <Resultado>A</Resultado>  Aprobación del comprob.
                  <CAEA>21064126523746</CAEA>
               </FECAEADetResponse>

---

<!-- page 174 -->

            </FeDetResp>
         </FECAEARegInformativoResult>
      </FECAEARegInformativoResponse>
   </soap:Body>
</soap:Envelope>


Se envía un Request con tres Facturas A (número 38, 39 y 40), donde la número 38 supera
todas las validaciones excluyentes y la número 39 no supera una de las validaciones
excluyentes. Genera una aprobación parcial de la solicitud, el comprobante 38 es aprobado, el
39 rechazado y el 40 no es procesado generando su rechazo.


REQUEST

<soapenv:Envelope
xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
xmlns:ar="http://ar.gov.afip.dif.FEV1/">
   <soapenv:Header/>
   <soapenv:Body>
       <ar:FECAEARegInformativo>
          <ar:Auth>
             <ar:Token>PD…</ar:Token>
             <ar:Sign>jd..</ar:Sign>
             <ar:Cuit>23000000004</ar:Cuit>
          </ar:Auth>
          <ar:FeCAEARegInfReq>
             <ar:FeCabReq>
                <ar:CantReg>3</ar:CantReg>
                <ar:PtoVta>9800</ar:PtoVta>
                <ar:CbteTipo>1</ar:CbteTipo>
             </ar:FeCabReq>
             <ar:FeDetReq>
                <ar:FECAEADetRequest>
                    <ar:Concepto>1</ar:Concepto>
                    <ar:DocTipo>80</ar:DocTipo>
                    <ar:DocNro>30000000007</ar:DocNro>
                    <ar:CbteDesde>38</ar:CbteDesde>
                    <ar:CbteHasta>38</ar:CbteHasta>
                    <ar:CbteFch>20110211</ar:CbteFch>
                    <ar:ImpTotal>200.00</ar:ImpTotal>
                    <ar:ImpTotConc>100.00</ar:ImpTotConc>
                    <ar:ImpNeto>0</ar:ImpNeto>
                    <ar:ImpOpEx>100.00</ar:ImpOpEx>
                    <ar:ImpIva>0</ar:ImpIva>
                    <ar:ImpTrib>0</ar:ImpTrib>
                    <ar:MonId>PES</ar:MonId>
                    <ar:MonCotiz>1</ar:MonCotiz>
                    <ar:CondicionIVAReceptorId>1</ar:CondicionIVARecep-
torId>
                    <ar:CAEA>21064126523746</ar:CAEA>
                </ar:FECAEADetRequest>
                <ar:FECAEADetRequest>
                    <ar:Concepto>1</ar:Concepto>
                    <ar:DocTipo>80</ar:DocTipo>
                    <ar:DocNro>30000000007</ar:DocNro>
                    <ar:CbteDesde>39</ar:CbteDesde>

---

<!-- page 175 -->

                   <ar:CbteHasta>39</ar:CbteHasta>
                   <ar:CbteFch>20110211</ar:CbteFch>
                   <ar:ImpTotal>101.00</ar:ImpTotal>
                   <ar:ImpTotConc>100.00</ar:ImpTotConc>
                   <ar:ImpNeto>0</ar:ImpNeto>
                   <ar:ImpOpEx>0.00</ar:ImpOpEx>
                   <ar:ImpIva>0</ar:ImpIva>
                   <ar:ImpTrib>1</ar:ImpTrib>  Se informa ImpTrib
mayor a cero y no se informa el detalle <Tributos>
                   <ar:MonId>PES</ar:MonId>
                   <ar:MonCotiz>1</ar:MonCotiz>
                   <ar:CondicionIVAReceptorId>1</ar:CondicionIVARecep-
torId>
                   <ar:CAEA>21064126523746</ar:CAEA>
                </ar:FECAEADetRequest>
                <ar:FECAEADetRequest>
                   <ar:Concepto>1</ar:Concepto>
                   <ar:DocTipo>80</ar:DocTipo>
                   <ar:DocNro>30000000007</ar:DocNro>
                   <ar:CbteDesde>40</ar:CbteDesde>
                   <ar:CbteHasta>40</ar:CbteHasta>
                   <ar:CbteFch>20110211</ar:CbteFch>
                   <ar:ImpTotal>100.00</ar:ImpTotal>
                   <ar:ImpTotConc>0.00</ar:ImpTotConc>
                   <ar:ImpNeto>0</ar:ImpNeto>
                   <ar:ImpOpEx>100.00</ar:ImpOpEx>
                   <ar:ImpIva>0</ar:ImpIva>
                   <ar:ImpTrib>0</ar:ImpTrib>
                   <ar:MonId>PES</ar:MonId>
                   <ar:MonCotiz>1</ar:MonCotiz>
                   <ar:CondicionIVAReceptorId>1</ar:CondicionIVARecep-
torId>
                   <ar:CAEA>21064126523746</ar:CAEA>
                </ar:FECAEADetRequest>
             </ar:FeDetReq>
          </ar:FeCAEARegInfReq>
       </ar:FECAEARegInformativo>
   </soapenv:Body>
</soapenv:Envelope>


RESPONSE


<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
xmlns:xsd="http://www.w3.org/2001/XMLSchema">
   <soap:Body>
      <FECAEARegInformativoResponse
xmlns="http://ar.gov.afip.dif.FEV1/">
         <FECAEARegInformativoResult>
            <FeCabResp>
               <Cuit>23000000004</Cuit>
               <PtoVta>9800</PtoVta>
               <CbteTipo>1</CbteTipo>
               <FchProceso>20110308</FchProceso>
               <CantReg>3</CantReg>
               <Resultado>P</Resultado>  Aprobación Parcial de la

---

<!-- page 176 -->

                                             solicitud
                <Reproceso>N</Reproceso>
            </FeCabResp>
            <FeDetResp>
                <FECAEADetResponse>
                   <Concepto>1</Concepto>
                   <DocTipo>80</DocTipo>
                   <DocNro>30000000007</DocNro>
                   <CbteDesde>38</CbteDesde>
                   <CbteHasta>38</CbteHasta>
                   <CbteFch>20110211</CbteFch>
                   <Resultado>A</Resultado>  Aprobación del
                                               Comprobante
                   <CAEA>21064126523746</CAEA>
                </FECAEADetResponse>
                <FECAEADetResponse>
                   <Concepto>1</Concepto>
                   <DocTipo>80</DocTipo>
                   <DocNro>30000000007</DocNro>
                   <CbteDesde>39</CbteDesde>
                   <CbteHasta>39</CbteHasta>
                   <CbteFch>20110211</CbteFch>
                   <Resultado>R</Resultado>  Rechazo del
                                               Comprobante
                   <Observaciones>  Motivo del rechazo
                      <Obs>
                         <Code>900</Code>
                         <Msg>Si ImpTrib es mayor a 0 el objeto
Tributos y Tributo son obligatorios.</Msg>
                      </Obs>
                   </Observaciones>
                   <CAEA>21064126523746</CAEA>
                </FECAEADetResponse>
                <FECAEADetResponse>
                   <Concepto>1</Concepto>
                   <DocTipo>80</DocTipo>
                   <DocNro>30000000007</DocNro>
                   <CbteDesde>40</CbteDesde>
                   <CbteHasta>40</CbteHasta>
                   <CbteFch>20110211</CbteFch>
                   <Resultado>R</Resultado>  Rechazo del comprobante
no fue procesado por haber sido rechazado el comprobante anterior
                   <CAEA>21064126523746</CAEA>
                </FECAEADetResponse>
            </FeDetResp>
         </FECAEARegInformativoResult>
      </FECAEARegInformativoResponse>
   </soap:Body>
</soap:Envelope>


Se envía un Request con tres Facturas A (número 39, 40 y 41), donde la información enviada
en la cabecera del comprobante tiene alguna inconsistencia (se informa que el Request
contiene dos comprobantes y se envían tres) entonces se genera un rechazo total de la
solicitud.

---

<!-- page 177 -->

REQUEST

<soapenv:Envelope
xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
xmlns:ar="http://ar.gov.afip.dif.FEV1/">
   <soapenv:Header/>
   <soapenv:Body>
       <ar:FECAEARegInformativo>
          <ar:Auth>
             <ar:Token>PD…</ar:Token>
             <ar:Sign>jd..</ar:Sign>
             <ar:Cuit>23000000004</ar:Cuit>
          </ar:Auth>
          <ar:FeCAEARegInfReq>
             <ar:FeCabReq>
                <ar:CantReg>2</ar:CantReg>
                <ar:PtoVta>9800</ar:PtoVta>
                <ar:CbteTipo>1</ar:CbteTipo>
             </ar:FeCabReq>
             <ar:FeDetReq>
                <ar:FECAEADetRequest>
                    <ar:Concepto>1</ar:Concepto>
                    <ar:DocTipo>80</ar:DocTipo>
                    <ar:DocNro>30000000007</ar:DocNro>
                    <ar:CbteDesde>39</ar:CbteDesde>
                    <ar:CbteHasta>39</ar:CbteHasta>
                    <ar:CbteFch>20110211</ar:CbteFch>
                    <ar:ImpTotal>200.00</ar:ImpTotal>
                    <ar:ImpTotConc>100.00</ar:ImpTotConc>
                    <ar:ImpNeto>0</ar:ImpNeto>
                    <ar:ImpOpEx>100.00</ar:ImpOpEx>
                    <ar:ImpIva>0</ar:ImpIva>
                    <ar:ImpTrib>0</ar:ImpTrib>
                    <ar:MonId>PES</ar:MonId>
                    <ar:MonCotiz>1</ar:MonCotiz>
                    <ar:CondicionIVAReceptorId>1</ar:CondicionIVARecep-
torId>
                    <ar:CAEA>21064126523746</ar:CAEA>
                </ar:FECAEADetRequest>
                <ar:FECAEADetRequest>
                    <ar:Concepto>1</ar:Concepto>
                    <ar:DocTipo>80</ar:DocTipo>
                    <ar:DocNro>30000000007</ar:DocNro>
                    <ar:CbteDesde>40</ar:CbteDesde>
                    <ar:CbteHasta>40</ar:CbteHasta>
                    <ar:CbteFch>20110211</ar:CbteFch>
                    <ar:ImpTotal>100.00</ar:ImpTotal>
                    <ar:ImpTotConc>100.00</ar:ImpTotConc>
                    <ar:ImpNeto>0</ar:ImpNeto>
                    <ar:ImpOpEx>0.00</ar:ImpOpEx>
                    <ar:ImpIva>0</ar:ImpIva>
                    <ar:ImpTrib>0</ar:ImpTrib>
                    <ar:MonId>PES</ar:MonId>
                    <ar:MonCotiz>1</ar:MonCotiz>
                    <ar:CondicionIVAReceptorId>1</ar:CondicionIVARecep-
torId>
                    <ar:CAEA>21064126523746</ar:CAEA>
                </ar:FECAEADetRequest>

---

<!-- page 178 -->

               <ar:FECAEADetRequest>
                  <ar:Concepto>1</ar:Concepto>
                  <ar:DocTipo>80</ar:DocTipo>
                  <ar:DocNro>30000000007</ar:DocNro>
                  <ar:CbteDesde>41</ar:CbteDesde>
                  <ar:CbteHasta>41</ar:CbteHasta>
                  <ar:CbteFch>20110211</ar:CbteFch>
                  <ar:ImpTotal>100.00</ar:ImpTotal>
                  <ar:ImpTotConc>0.00</ar:ImpTotConc>
                  <ar:ImpNeto>0</ar:ImpNeto>
                  <ar:ImpOpEx>100.00</ar:ImpOpEx>
                  <ar:ImpIva>0</ar:ImpIva>
                  <ar:ImpTrib>0</ar:ImpTrib>
                  <ar:MonId>PES</ar:MonId>
                  <ar:MonCotiz>1</ar:MonCotiz>
                  <ar:CondicionIVAReceptorId>1</ar:CondicionIVARecep-
torId>
                   <ar:CAEA>21064126523746</ar:CAEA>
               </ar:FECAEADetRequest>
            </ar:FeDetReq>
         </ar:FeCAEARegInfReq>
      </ar:FECAEARegInformativo>
   </soapenv:Body>
</soapenv:Envelope>


RESPONSE


<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
xmlns:xsd="http://www.w3.org/2001/XMLSchema">
   <soap:Body>
      <FECAEARegInformativoResponse
xmlns="http://ar.gov.afip.dif.FEV1/">
         <FECAEARegInformativoResult>
            <FeCabResp>
               <Cuit>23000000004</Cuit>
               <PtoVta>9800</PtoVta>
               <CbteTipo>1</CbteTipo>
               <FchProceso>20110308</FchProceso>
               <CantReg>2</CantReg>
               <Resultado>R</Resultado> Rechazo total del envío
               <Reproceso>N</Reproceso>
            </FeCabResp>
            <FeDetResp>
               <FECAEADetResponse>
                  <Concepto>1</Concepto>
                  <DocTipo>80</DocTipo>
                  <DocNro>30000000007</DocNro>
                  <CbteDesde>39</CbteDesde>
                  <CbteHasta>39</CbteHasta>
                  <CbteFch>20110211</CbteFch>
                  <Resultado>R</Resultado>
                  <CAEA>21064126523746</CAEA>
               </FECAEADetResponse>
               <FECAEADetResponse>
                  <Concepto>1</Concepto>

---

<!-- page 179 -->

                   <DocTipo>80</DocTipo>
                   <DocNro>30000000007</DocNro>
                   <CbteDesde>40</CbteDesde>
                   <CbteHasta>40</CbteHasta>
                   <CbteFch>20110211</CbteFch>
                   <Resultado>R</Resultado>
                   <CAEA>21064126523746</CAEA>
                </FECAEADetResponse>
                <FECAEADetResponse>
                   <Concepto>1</Concepto>
                   <DocTipo>80</DocTipo>
                   <DocNro>30000000007</DocNro>
                   <CbteDesde>41</CbteDesde>
                   <CbteHasta>41</CbteHasta>
                   <CbteFch>20110211</CbteFch>
                   <Resultado>R</Resultado>
                   <CAEA>21064126523746</CAEA>
                </FECAEADetResponse>
            </FeDetResp>
            <Errors>
                <Err>                  Motivo del Rechazo
                   <Code>10002</Code>
                   <Msg>Campo CantReg debe ser igual a lo informado en
detalle. Informado: 2, Enviado:3</Msg>
                </Err>
            </Errors>
         </FECAEARegInformativoResult>
      </FECAEARegInformativoResponse>
   </soap:Body>
</soap:Envelope>


Se envía un Request con una Facturas B con Importe Gravado y alícuota de IVA al 21%, supera
la totalidad de las validaciones. El comprobante es aprobado.


REQUEST


<soapenv:Envelope
xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
xmlns:ar="http://ar.gov.afip.dif.FEV1/">
   <soapenv:Header/>
   <soapenv:Body>
      <ar:FECAEARegInformativo>
         <ar:Auth>
            <ar:Token>PD…</ar:Token>
            <ar:Sign>jd..</ar:Sign>
            <ar:Cuit>23000000004</ar:Cuit>
         </ar:Auth>
         <ar:FeCAEARegInfReq>
            <ar:FeCabReq>
               <ar:CantReg>1</ar:CantReg>
               <ar:PtoVta>9800</ar:PtoVta>
               <ar:CbteTipo>6</ar:CbteTipo>
            </ar:FeCabReq>
            <ar:FeDetReq>

---

<!-- page 180 -->

               <ar:FECAEADetRequest>
                  <ar:Concepto>2</ar:Concepto>
                  <ar:DocTipo>80</ar:DocTipo>
                  <ar:DocNro>30000000007</ar:DocNro>
                  <ar:CbteDesde>45</ar:CbteDesde>
                  <ar:CbteHasta>45</ar:CbteHasta>
                  <ar:CbteFch>20110211</ar:CbteFch>
                  <ar:ImpTotal>121.00</ar:ImpTotal>
                  <ar:ImpTotConc>0.00</ar:ImpTotConc>
                  <ar:ImpNeto>100</ar:ImpNeto> Imp Neto Gravado
                  <ar:ImpOpEx>0.00</ar:ImpOpEx>
                  <ar:ImpIVA>21</ar:ImpIVA>    Importe IVA liquidado
                  <ar:ImpTrib>0</ar:ImpTrib>
                  <ar:FchServDesde>20110101</ar:FchServDesde>
                  <ar:FchServHasta>20110102</ar:FchServHasta>
                  <ar:FchVtoPago>20110220</ar:FchVtoPago>
                  <ar:MonId>PES</ar:MonId>
                  <ar:MonCotiz>1</ar:MonCotiz>
                  <ar:CondicionIVAReceptorId>1</ar:CondicionIVARecep-
torId>
                   <ar:Iva>
                      <ar:AlicIva>
                         <ar:Id>5</ar:Id> Alícuota de IVA 21%
                         <ar:BaseImp>100</ar:BaseImp> Base Imponible
                                       para la Alícuota indicada en Id
                         <ar:Importe>21</ar:Importe> Imp IVA liquidado
                      </ar:AlicIva>
                   </ar:Iva>
                   <ar:CAEA>21064126523746</ar:CAEA>
               </ar:FECAEADetRequest>
            </ar:FeDetReq>
         </ar:FeCAEARegInfReq>
      </ar:FECAEARegInformativo>
   </soapenv:Body>
</soapenv:Envelope>


RESPONSE


<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
xmlns:xsd="http://www.w3.org/2001/XMLSchema">
   <soap:Body>
      <FECAEARegInformativoResponse
xmlns="http://ar.gov.afip.dif.FEV1/">
         <FECAEARegInformativoResult>
            <FeCabResp>
               <Cuit>23000000004</Cuit>
               <PtoVta>9800</PtoVta>
               <CbteTipo>6</CbteTipo>
               <FchProceso>20110314</FchProceso>
               <CantReg>1</CantReg>
               <Resultado>A</Resultado>
               <Reproceso>N</Reproceso>
            </FeCabResp>
            <FeDetResp>
               <FECAEADetResponse>

---

<!-- page 181 -->

                   <Concepto>2</Concepto>
                   <DocTipo>80</DocTipo>
                   <DocNro>30000000007</DocNro>
                   <CbteDesde>45</CbteDesde>
                   <CbteHasta>45</CbteHasta>
                   <CbteFch>20110211</CbteFch>
                   <Resultado>A</Resultado>
                   <CAEA>21064126523746</CAEA>
                </FECAEADetResponse>
            </FeDetResp>
         </FECAEARegInformativoResult>
      </FECAEARegInformativoResponse>
   </soap:Body>
</soap:Envelope>


Se envía un Request con una Facturas A con Importe Gravado, alícuota de IVA al 21%, 27% y al
0%, Importes Exentos y No Gravados y con importes de Tributos (IIBB), supera la totalidad de
las validaciones. El comprobante es aprobado.


REQUEST


<soapenv:Envelope <soapenv:Envelope
xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
xmlns:ar="http://ar.gov.afip.dif.FEV1/">
   <soapenv:Header/>
   <soapenv:Body>
      <ar:FECAEARegInformativo>
         <ar:Auth>
            <ar:Token>PD…</ar:Token>
            <ar:Sign>jd..</ar:Sign>
            <ar:Cuit>23000000004</ar:Cuit>
         </ar:Auth>
         <ar:FeCAEARegInfReq>
            <ar:FeCabReq>
               <ar:CantReg>1</ar:CantReg>
               <ar:PtoVta>9800</ar:PtoVta>
               <ar:CbteTipo>1</ar:CbteTipo>
            </ar:FeCabReq>
            <ar:FeDetReq>
               <ar:FECAEADetRequest>
                   <ar:Concepto>1</ar:Concepto>
                   <ar:DocTipo>80</ar:DocTipo>
                   <ar:DocNro>30000000007</ar:DocNro>
                   <ar:CbteDesde>40</ar:CbteDesde>
                   <ar:CbteHasta>40</ar:CbteHasta>
                   <ar:CbteFch>20110211</ar:CbteFch>
                   <ar:ImpTotal>549.00</ar:ImpTotal>
                   <ar:ImpTotConc>100.00</ar:ImpTotConc>  No Gravado
                   <ar:ImpNeto>300</ar:ImpNeto>  Gravado. Igual a la
                                  sumatoria de BaseImp del Array de Iva.
                   <ar:ImpOpEx>100.00</ar:ImpOpEx>  Imp Exento
                   <ar:ImpIVA>48</ar:ImpIVA>  Importe total de IVA
liquidado. Es igual a la sumatoria de Importe del Array de Iva.

---

<!-- page 182 -->

                  <ar:ImpTrib>1</ar:ImpTrib>  Importe total de
tributos. Es igual a la sumatoria de Importe del Array de Tributos.
                  <ar:MonId>PES</ar:MonId>
                  <ar:MonCotiz>1</ar:MonCotiz>
                  <ar:CondicionIVAReceptorId>1</ar:CondicionIVARecep-
torId>
                  <ar:Tributos>  Detalle de Tributos
                     <ar:Tributo>
                        <ar:Id>2</ar:Id>
                        <ar:Desc>IIBB Pcia Bs AS</ar:Desc>
                        <ar:BaseImp>100</ar:BaseImp>
                        <ar:Alic>1</ar:Alic>
                        <ar:Importe>1</ar:Importe>
                     </ar:Tributo>
                  </ar:Tributos>
                 <ar:Iva>  Detalle IVA Liquidado
                     <ar:AlicIva>
                        <ar:Id>5</ar:Id>  21% IVA
                        <ar:BaseImp>100</ar:BaseImp> Base Imponible
                                      para la Alícuota indicada en Id
                        <ar:Importe>21</ar:Importe> Imp IVA liquidado
                                      según Alícuota y Base Imponible.

                      </ar:AlicIva>
                     <ar:AlicIva>
                         <ar:Id>3</ar:Id>  0% IVA
                         <ar:BaseImp>100</ar:BaseImp>Base Imponible
                                       para la alícuota indicada en Id
                         <ar:Importe>0</ar:Importe> Imp IVA liquidado
                                       según Alícuota y Base Imponible.
                      </ar:AlicIva>
                      <ar:AlicIva>
                         <ar:Id>6</ar:Id>  27% IVA
                         <ar:BaseImp>100</ar:BaseImp> Base Imponible
                                       para la Alícuota indicada en Id
                         <ar:Importe>27</ar:Importe> Imp IVA liquidado
                                       según Alícuota y Base Imponible.
                      </ar:AlicIva>
                   </ar:Iva>
                   <ar:CAEA>21064126523746</ar:CAEA>
               </ar:FECAEADetRequest>
            </ar:FeDetReq>
         </ar:FeCAEARegInfReq>
      </ar:FECAEARegInformativo>
   </soapenv:Body>
</soapenv:Envelope>


RESPONSE


<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
xmlns:xsd="http://www.w3.org/2001/XMLSchema">
   <soap:Body>
      <FECAEARegInformativoResponse
xmlns="http://ar.gov.afip.dif.FEV1/">
         <FECAEARegInformativoResult>

---

<!-- page 183 -->

            <FeCabResp>
                <Cuit>23000000004</Cuit>
                <PtoVta>9800</PtoVta>
                <CbteTipo>6</CbteTipo>
                <FchProceso>20110314</FchProceso>
                <CantReg>1</CantReg>
                <Resultado>A</Resultado>
                <Reproceso>N</Reproceso>
            </FeCabResp>
            <FeDetResp>
                <FECAEADetResponse>
                   <Concepto>1</Concepto>
                   <DocTipo>80</DocTipo>
                   <DocNro>30000000007</DocNro>
                   <CbteDesde>40</CbteDesde>
                   <CbteHasta>40</CbteHasta>
                   <CbteFch>20110211</CbteFch>
                   <Resultado>A</Resultado>
                   <CAEA>21064126523746</CAEA>
                </FECAEADetResponse>
            </FeDetResp>
         </FECAEARegInformativoResult>
      </FECAEARegInformativoResponse>
   </soap:Body>
</soap:Envelope>



Método para consultar CAEA sin movimiento (FECAEASinMovimientoConsultar)

Esta operación permite consultar mediante un CAEA, cuáles fueron los puntos de venta que
fueron notificados como sin movimiento. El cliente envía el requerimiento, el cual es atendido
por el WS, superadas las validaciones de seguridad se informa el CAEA, puntos de venta
identificados como sin movimientos y fecha de proceso. En caso de informar el punto de
venta, se informan los datos vinculados a ese punto de venta en particular.


Dirección URL (Homologación)
Este servicio se llama desde:

https://wswhomo.afip.gov.ar/wsfev1/service.asmx?op=
FECAEASinMovimientoConsultar




Mensaje de solicitud
  <soapenv:Envelope
  xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:ar="http://ar.gov.afip.dif.FEV1/">
     <soapenv:Header/>
     <soapenv:Body>
        <ar:FECAEASinMovimientoConsultar>
         <ar:Auth>
              <ar:Token>string</ar:Token>
              <ar:Sign>string</ar:Sign>

---

<!-- page 184 -->

              <ar:Cuit>long</ar:Cuit>
           </ar:Auth>
           <ar:CAEA>string</ar:CAEA>
           <ar:PtoVta>int</ar:PtoVta>
        </ar:FECAEASinMovimientoConsultar>
     </soapenv:Body>
  </soapenv:Envelope>



dónde:



       Campo                                 Detalle                             Obligatorio
                   Información de la autenticación. Contiene los datos de
Auth                                                                                 S
                   Token, Sign y Cuit
Token              Token devuelto por el WSAA                                        S
Sign               Sign devuelto por el WSAA                                         S
Cuit               Cuit contribuyente (representado o Emisora)                       S


        Campo                                 Detalle                             Obligatorio
                     CAEA otorgado, e identificado como “Sin Movimientos”
CAEA                                                                                      S
                     para determinados puntos de venta.
PtoVta               Punto de venta vinculado al CAEA informado.                          S


Mensaje de respuesta
Retorna los puntos de venta vinculados al CAEA ingresado por parámetro donde los mismos
estén registrados como sin movimientos.

  <soap12:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-
  envelope" xmlns:ar="http://ar.gov.afip.dif.FEV1/">
     <soap12:Header/>
     <soap12:Body>
        <FECAEASinMovimientoConsultarResponse>
           <FECAEASinMovimientoConsultarResult>
              <ResultGet>
                 <FECAEASinMov>
                    <CAEA>string</CAEA>
                    <FchProceso>string</FchProceso>
                    <PtoVta>int</PtoVta>
                 </FECAEASinMov>
              </ResultGet>
              <Errors>
                 <Err>
                    <Code>int</Code>
                    <Msg>string</Msg>
                 </Err>
              </Errors>

---

<!-- page 185 -->

              <Events>
                 <Evt>
                     <Code>int</Code>
                     <Msg>string</Msg                                 </Evt>
              </Events>
           </FECAEASinMovimientoConsultarResult>
        </FECAEASinMovimientoConsultarResponse>
     </soapenv:Body>
  </soapenv:Envelope>



dónde:



FECAEASinMovimientoResult



      Campo                                     Detalle                             Obligatorio
                      Nodo contenedor del array de elementos correspondientes
 ResultGet            a él o los puntos de venta identificados como sin                  S
                      movimientos para el CAEA identificado.
 Errors               Información de errores detectados                                 N
 Events               Información de eventos                                            N




ResultGet: contiene la información de los puntos de venta informados



        Campo             Tipo                          Detalle                     Obligatorio
 CAEA                 String (14)   Código de Autorización electrónico anticipado       S
                                    Fecha de en que se informó cómo sin
 FchProceso           String (8)                                                        S
                                    movimiento al CAEA Pto Vta indicados.
                                    Punto de venta vinculado al CAEA
 PtoVta               Int (5)                                                           S
                                    informado.


Validaciones y errores


Controles aplicados

---

<!-- page 186 -->

                                Código de
       Campo / Grupo                                              Validación
                                  error
CAEA                             10100      No ingreso el CAEA o el formato es inválido.
PtoVta                           10101      No ingreso el Punto de Venta o el formato es inválido.
                                            El CAEA informado no se encuentra registrado en las
CAEA                             10102
                                            bases de la Administración como sin movimientos.
                                            El punto de venta ingresado registra comprobantes
CAEA / PtoVta                    10105
                                            informados



Método para consultar Comprobantes Emitidos y su código (FECompConsultar)

Esta operación permite consultar mediante tipo, numero de comprobante y punto de venta los
datos de un comprobante ya emitido. Dentro de los datos del comprobante resultante se
obtiene el tipo de emisión utilizado para generar el código de autorización.


Dirección URL (Homologación)
Este servicio se llama desde:

https://wswhomo.afip.gov.ar/wsfev1/service.asmx?op= FECompConsultar




Mensaje de solicitud
  <soapenv:Envelope
  xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:ar="http://ar.gov.afip.dif.FEV1/">
     <soapenv:Header/>
     <soapenv:Body>
        <ar:FECompConsultar>
        <ar:Auth>
              <ar:Token>string</ar:Token>
              <ar:Sign>string</ar:Sign>
              <ar:Cuit>long</ar:Cuit>
           </ar:Auth>
           <ar:FeCompConsReq>
              <ar:CbteTipo>int</ar:CbteTipo>
              <ar:CbteNro>long</ar:CbteNro>
              <ar:PtoVta>int</ar:PtoVta>
           </ar:FeCompConsReq>
        </ar:FECompConsultar>
     </soapenv:Body>
  </soapenv:Envelope>



donde:

         Campo                                   Detalle                              Obligatorio
 Auth                  Información de la autenticación. Contiene los datos de              S

---

<!-- page 187 -->

                     Token, Sign y Cuit
 Token               Token devuelto por el WSAA                                    S
 Sign                Sign devuelto por el WSAA                                     S
 Cuit                Cuit contribuyente (representado o Emisora)                   S


         Campo                                 Detalle                         Obligatorio
 FeCompConsReq        Información del comprobante que se desea consultar.          S


         Campo                                  Detalle                        Obligatorio
CbteTipo              Tipo de Comprobante                                              S
CbteNro               Número de comprobante                                            S
PtoVta                Punto de venta                                                   S




Mensaje de respuesta
Retorna los datos del Comprobante coincidente con los parámetros ingresados.

  <soap12:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-
  envelope" xmlns:ar="http://ar.gov.afip.dif.FEV1/">
     <soap12:Header/>
     <soap12:Body>
        <FECompConsultarResponse>
           <FECompConsultarResult>
              <ResultGet>
                 <Concepto>int</Concepto>
                 <DocTipo>int</DocTipo>
                 <DocNro>long</DocNro>
                 <CbteDesde>long</CbteDesde>
                 <CbteHasta>long</CbteHasta>
                 <CbteFch>string</CbteFch>
                 <ImpTotal>double</ImpTotal>
                 <ImpTotConc>double</ImpTotConc>
                 <ImpNeto>double</ImpNeto>
                 <ImpOpEx>double</ImpOpEx>
                 <ImpTrib>double</ImpTrib>
                 <ImpIVA>double</ImpIVA>
                 <FchServDesde>string</FchServDesde>
                 <FchServHasta>string</FchServHasta>
                 <FchVtoPago>string</FchVtoPago>
                 <MonId>string</MonId>
                 <MonCotiz>double</MonCotiz>
                 <CbtesAsoc>
                    <CbteAsoc>
                       <Tipo>int</Tipo>

---

<!-- page 188 -->

          <PtoVta>int</PtoVta>
          <Nro>long</Nro>
      </CbteAsoc>
   </CbtesAsoc>
   <Tributos>
      <Tributo>
          <Id>int</Id>
          <Desc>string</Desc>
          <BaseImp>double</BaseImp>
          <Alic>double</Alic>
          <Importe>double</Importe>
      </Tributo>
   </Tributos>
   <Iva>
      <AlicIva>
          <Id>int</Id>
          <BaseImp>double</BaseImp>
          <Importe>double</Importe>
      </AlicIva>
   </Iva>
   <Opcionales>
      <Opcional>
          <Id>string</Id>
          <Valor>string</Valor>
      </Opcional>
   </Opcionales>
   <Compradores>
      <Comprador>
         <DocTipo>int</DocTipo>
         <DocNro>long</DocNro>
         <Porcentaje>double</Porcentaje>
      </Comprador>
   </Compradores>
   <ar:PeriodoAsoc>
      <ar:FchDesde>string</ar:FchDesde>
      <ar:FchHasta>string</ar:FchHasta>
   </ar:PeriodoAsoc>
   <Resultado>string</Resultado>
   <CodAutorizacion>string</CodAutorizacion>
   <EmisionTipo>string</EmisionTipo>
   <FchVto>string</FchVto>
   <FchProceso>string</FchProceso>
   <Observaciones>
      <Obs>
          <Code>int</Code>
          <Msg>string</Msg>
      </Obs>
   </Observaciones>
   <PtoVta>int</PtoVta>
   <CbteTipo>int</CbteTipo>
</ResultGet>
<Errors>
   <Err>
      <Code>int</Code>
      <Msg>string</Msg>
   </Err>
</Errors>

---

<!-- page 189 -->

              <Events>
                 <Evt>
                     <Code>int</Code>
                     <Msg>string</Msg>
                 </Evt>
              </Events>
           </FECompConsultarResult>
        </FECompConsultarResponse>
     </soapenv:Body>
  </soapenv:Envelope>



dónde:



            Campo                                    Detalle                          Obligatorio
FECompConsultarResult         Nodo contenedor correspondiente a él comprobante             S
                              solicitado. Contiene los datos ResultGet, Errors y
                              Events
Errors                        Información de errores detectados                            N
Events                        Información de eventos                                       N


ResultGet: El objeto resultante informante del resultado del proceso contiene los campos
identificados como valores de entrada FECAEDetRequest (request) en el método
FECAESolicitar + los siguientes atributos.




         Campo                                   Detalle                              Obligatorio
Resultado             Resultado del procesamiento del comprobante                          S
CodAutorizacion       Código de Autorización                                               S
EmisionTipo           Tipo de emisión, si corresponde a CAE o CAEA                         S
FchVto                Vencimiento del código de autorización. Si tipo de emisión es        S
                      igual a CAE esta es la fecha de vencimiento obtenida cuando
                      se autorizó el comprobante. Si tipo de emisión es igual a
                      CAEA esta es la fecha de “vigencia hasta” del CAEA obtenida
                      cuando gestionó el CAEA.
FchProceso            Fecha de procesamiento del comprobante                               S
Observaciones         Observaciones identificadas al momento de generar el                 N
                      comprobante.
PtoVta                Punto de venta                                                       S
CbteTipo              Tipo de Comprobante                                                  S

---

<!-- page 190 -->

Validaciones y errores


Controles aplicados

     Campo / Grupo       Código de error                    Validación

                                           No ingreso el Punto de Venta o el formato es
PtoVta                       10200
                                           inválido.
                                           No ingreso el Tipo de Comprobante, o el tipo
CbteTipo                     10201
                                           de comprobante es inválido.
                                           El punto de venta ingresado no se encuentra
PtoVta                       10104
                                           registrado.
                                           No ingreso el número de comprobante o el
CbteNro                      10202
                                           formato es inválido.




Ejemplo


REQUEST

<soapenv:Envelope
xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
xmlns:ar="http://ar.gov.afip.dif.FEV1/">
   <soapenv:Header/>
   <soapenv:Body>
      <ar:FECompConsultar>
      <ar:Auth>
            <ar:Token>string</ar:Token>
            <ar:Sign>string</ar:Sign>
            <ar:Cuit>33693450239</ar:Cuit>
         </ar:Auth>
         <ar:FeCompConsReq>
            <ar:CbteTipo>1</ar:CbteTipo>
            <ar:CbteNro>1</ar:CbteNro>
            <ar:PtoVta>12</ar:PtoVta>
         </ar:FeCompConsReq>
      </ar:FECompConsultar>
   </soapenv:Body>
</soapenv:Envelope>


RESPONSE

---

<!-- page 191 -->

<soap12:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"
xmlns:ar="http://ar.gov.afip.dif.FEV1/">
   <soap12:Header/>
   <soap12:Body>
      <FECompConsultarResponse>
         <FECompConsultarResult>
            <ResultGet>
               <Concepto>1</Concepto>
               <DocTipo>80</DocTipo>
               <DocNro>20111111112</DocNro>
               <CbteDesde>1</CbteDesde>
               <CbteHasta>1</CbteHasta>
               <CbteFch>20100903</CbteFch>
               <ImpTotal>184.05</ImpTotal>
               <ImpTotConc>0</ImpTotConc>
               <ImpNeto>150</ImpNeto>
               <ImpOpEx>0</ImpOpEx>
               <ImpTrib>7.8</ImpTrib>
               <ImpIVA>26.25</ImpIVA>
               <FchServDesde></FchServDesde>
               <FchServHasta></FchServHasta>
               <FchVtoPago></FchVtoPago>
               <MonId>PES</MonId>
               <MonCotiz>1</MonCotiz>
               <Tributos>
                   <Tributo>
                      <Id>99</Id>
                      <Desc>Impuesto Municipal Matanza</Desc>
                      <BaseImp>150</BaseImp>
                      <Alic>5.2</Alic>
                      <Importe>7.8</Importe>
                   </Tributo>
               </Tributos>
               <Iva>
                   <AlicIva>
                      <Id>5</Id>
                      <BaseImp>100</BaseImp>
                      <Importe>21</Importe>
                   </AlicIva>
                   <AlicIva>
                      <Id>4</Id>
                      <BaseImp>50</BaseImp>
                      <Importe>5.25</Importe>
                   </AlicIva>
               </Iva>
               <Resultado>A</Resultado>
               <CodAutorizacion>41124578989845</CodAutorizacion>
               <EmisionTipo>CAE</EmisionTipo>
               <FchVto>20100913</FchVto>
               <FchProceso>20100902</FchProceso>
               <PtoVta>12</PtoVta>
               <CbteTipo>1</CbteTipo>
            </ResultGet>
         </FECompConsultarResult>
      </FECompConsultarResponse>
   </soapenv:Body>
</soapenv:Envelope>

---

<!-- page 192 -->

Método para consultar valores referenciales de códigos de países
(FEParamGetTiposPaises)

Esta operación permite consultar los códigos de países y descripción de los mismos.


Dirección URL (Homologación)
Este servicio se llama desde:

https://wswhomo.afip.gov.ar/wsfev1/service.asmx?op=
FEParamGetTiposPaises

Mensaje de solicitud
Recibe las credenciales de autenticación y la cuit del usuario representado.

  <soapenv:Envelope
  xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:ar="http://ar.gov.afip.dif.FEV1/">
     <soapenv:Header/>
     <soapenv:Body>
        <ar:FEParamGetTiposPaises>
           <ar:Auth>
              <ar:Token>string</ar:Token>
              <ar:Sign>string</ar:Sign>
              <ar:Cuit>long</ar:Cuit>
           </ar:Auth>
        </ar:FEParamGetTiposPaises>
     </soapenv:Body>
  </soapenv:Envelope>


donde:

       Campo                                  Detalle                                 Obligatorio
                    Información de la autenticación. Contiene los datos de
Auth                                                                                      S
                    Token, Sign , Cuit
Token               Token devuelto por el WSAA                                            S
Sign                Sign devuelto por el WSAA                                             S
Cuit                Cuit contribuyente (representado o Emisora)                           S


Mensaje de respuesta
  <?xml version="1.0" encoding="utf-8"?>
  <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-
  instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"
  xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
    <soap:Body>
       <FEParamGetTiposPaisesResponse
  xmlns="http://ar.gov.afip.dif.FEV1/">
           <FEParamGetTiposPaisesResult>
              <ResultGet>

---

<!-- page 193 -->

                  <PaisTipo>
                     <Id>int</Id>
                     <Desc>string</Desc>
                  </PaisTipo>
                  <PaisTipo>
                     <Id>int</Id>
                     <Desc>string</Desc>
                  </PaisTipo>
                  <PaisTipo>
                     <Id>int</Id>
                     <Desc>string</Desc>
                  </PaisTipo>
                  <PaisTipo>
                     <Id>int</Id>
                     <Desc>string</Desc>
                  </PaisTipo>
             </ResultGet>
           </FEParamGetTiposPaisesResult>
        </FEParamGetTiposPaisesResponse>
     </soap:Body>
  </soap:Envelope>



dónde:

FEParamGetTiposPaisesResult:

        Campo                                     Detalle                               Obligatorio
 ResultGet            Información sobre los tipos de países aceptados.                       N
 Errors               Información de errores detectados                                      N
 Events               Información de eventos                                                 N


ResultGet:

      Campo                  Tipo                           Detalle                    Obligatorio
 Id                Int (3)            Código de país                                         S
 Desc              String (250)       Descripción                                            S



Método para consultar las actividades (FEParamGetActividades)

Esta operación permite consultar los códigos de actividades, sus descripciones y el orden (si es
actividad primaria, secundaria, etc)


Dirección URL (Homologación)
Este servicio se llama desde:

https://wswhomo.afip.gov.ar/wsfev1/service.asmx?op=
FEParamGetActividades

---

<!-- page 194 -->

Mensaje de solicitud
Recibe las credenciales de autenticación y la cuit del usuario representado.

  <soapenv:Envelope
  xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:ar="http://ar.gov.afip.dif.FEV1/">
     <soapenv:Header/>
     <soapenv:Body>
        <ar:FEParamGetActividades>
           <ar:Auth>
               <ar:Token>string</ar:Token>
               <ar:Sign>string</ar:Sign>
               <ar:Cuit>long</ar:Cuit>
           </ar:Auth>
        </ar: FEParamGetActividades>
     </soapenv:Body>
  </soapenv:Envelope>


Dónde:

       Campo                                  Detalle                          Obligatorio
                    Información de la autenticación. Contiene los datos de
Auth                                                                               S
                    Token, Sign , Cuit
Token               Token devuelto por el WSAA                                     S
Sign                Sign devuelto por el WSAA                                      S
Cuit                Cuit contribuyente (representado o Emisora)                    S

Mensaje de respuesta
  <?xml version="1.0" encoding="utf-8"?>
  <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-
  instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"
  xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
    <soap:Body>
       < FEParamGetActividadesResponse
  xmlns="http://ar.gov.afip.dif.FEV1/">
            <FEParamGetActividadesResult>
               <ResultGet>
                  < ActividadesTipo>
                      <Id>long</Id>
                      <Orden>short</Orden>
                      <Desc>string</Desc>
                  </ ActividadesTipo>
                  < ActividadesTipo>
                      <Id>long</Id>
                      <Orden>short</Orden>
                      <Desc>string</Desc>
                  </ ActividadesTipo>
                  < ActividadesTipo>
                      <Id>long</Id>
                      <Orden>short</Orden>
                      <Desc>string</Desc>
                  </ ActividadesTipo>

---

<!-- page 195 -->

                  < ActividadesTipo>
                      <Id>long</Id>
                      <Orden>short</Orden>
                      <Desc>string</Desc>
                  </ ActividadesTipo>
             </ResultGet>
           </FEParamGetActividadesResult>
        </FEParamGetActividadesResponse>
     </soap:Body>
  </soap:Envelope>




Dónde:

FEParamGetTiposPaisesResult:

        Campo                                     Detalle                               Obligatorio
                       Información sobre los tipos de actividades que el emisor
 ResultGet                                                                                   N
                       tiene habilitadas.
 Errors                Información de errores detectados                                     N
 Events                Información de eventos                                                N


ResultGet:

      Campo               Tipo                              Detalle                     Obligatorio
 Id                Long               Identificador de Actividad                             S
 Orden             Short(3)           Orden de la Actividad                                  S
 Desc              String (180)       Descripción de la Actividad                            S




Método para consultar valores referenciales de los identificadores de la condición frente
al IVA del receptor (FEParamGetCondicionIvaReceptor)

Esta operación permite consultar los identificadores de la condicion frente al IVA del receptor,
su descripción y a la clase de comprobante que corresponde.


Dirección URL (Homologación)
Este servicio se llama desde:

https://wswhomo.afip.gov.ar/wsfev1/service.asmx?
op=FEParamGetCondicionIvaReceptor

Mensaje de solicitud
Recibe las credenciales de autenticación y la cuit del usuario representado.

---

<!-- page 196 -->

  <soapenv:Envelope
  xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:ar="http://ar.gov.afip.dif.FEV1/">
     <soapenv:Header/>
     <soapenv:Body>
        <ar:FEParamGetCondicionFrenteIvaReceptor>
           <ar:Auth>
              <ar:Token>string</ar:Token>
              <ar:Sign>string</ar:Sign>
              <ar:Cuit>long</ar:Cuit>
           </ar:Auth>
           <ar:ClaseCmp>string</ar:ClaseCmp>
        </ar:FEParamGetCondicionFrenteIvaReceptor>
     </soapenv:Body>
  </soapenv:Envelope>


donde:

       Campo                               Detalle                            Obligatorio
                 Información de la autenticación. Contiene los datos de
Auth                                                                              S
                 Token, Sign , Cuit
Token            Token devuelto por el WSAA                                       S
Sign             Sign devuelto por el WSAA                                        S
Cuit             Cuit contribuyente (representado o Emisora)                      S
                 Clase de comprobante. Valores posibles A, ALEY (A con
                 leyenda ‘operación sujeta a retención’), B, C o 49 (Bienes
ClaseCmp         Usados). En caso de no informar el dicho campo, el               N
                 método lista todas las combinaciones posibles de todas
                 las clases de comprobantes.


Mensaje de respuesta
  <?xml version="1.0" encoding="utf-8"?>
  <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-
  instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"
  xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
    <soap:Body>
       <FEParamGetCondicionIvaReceptorResponse
  xmlns="http://ar.gov.afip.dif.FEV1/">
           <FEParamGetCondicionIvaReceptorResult>
              <ResultGet>
                 <CondicionIvaReceptor>
                    <Id>int</Id>
                    <Desc>string</Desc>
                    <Cmp_Clase>string</Cmp_Clase>
                 </CondicionIvaReceptor>
                 <CondicionIvaReceptor>
                    <Id>int</Id>
                    <Desc>string</Desc>
                    <Cmp_Clase>string</Cmp_Clase>
                 </CondicionIvaReceptor>

---

<!-- page 197 -->

                  <CondicionIvaReceptor>
                     <Id>int</Id>
                     <Desc>string</Desc>
                     <Cmp_Clase>string</Cmp_Clase>
                  </CondicionIvaReceptor>
                  <CondicionIvaReceptor>
                     <Id>int</Id>
                     <Desc>string</Desc>
                     <Cmp_Clase>string</Cmp_Clase>
                  </CondicionIvaReceptor>
             </ResultGet>
           </FEParamGetCondicionIvaReceptorResult>
        </FEParamGetCondicionIvaReceptorResponse>
     </soap:Body>
  </soap:Envelope>




Dónde:

FEParamGetCondicionIvaReceptorResult:

        Campo                                    Detalle                            Obligatorio
 CondicionIvaRece      Información sobre la combinación de la condición de iva de
                                                                                         N
 ptor                  receptor y la clase de comprobante permitidas.
 Errors                Información de errores detectados                                 N
 Events                Información de eventos                                            N




CondicionIvaReceptor:

      Campo                   Tipo                         Detalle                  Obligatorio
                                      Identificador de la condicion de IVA del
 Id                 Int (3)                                                             S
                                      receptor
 Desc               String (250)      Descripción                                       S
 Cmp_Clase          String (5)        Clase de comprobante                              S




Validaciones y errores
Validaciones que se aplican sobre el objeto <FEParamGetCondicionIvaReceptor>

---

<!-- page 198 -->

                    Código
Campo/Grupo                                               Descripción de la validación
                    de error

                                 El valor del campo <Cmp_Clase> ingresado para la clase de compro-
  Cmp_Clase                      bante no es valido. La clase de Comprobante es opcional, de ingresar
                     10244
                                 un valor solo puede ser A, B, C, ALEY (A con leyenda ‘operación sujeta
                                 a retención’) o 49 (Bienes Usados),




Margen de error mediante (Error Absoluto y Error Relativo)

        Error Absoluto eabs: Es la diferencia entre el valor medido (calculado) y el valor real

        Error Relativo erel : Es el cociente entre el valor error absoluto y el valor real.

        En ambos casos se tomará el valor absoluto, es decir el signo resultante de la opera-
        ción no se considerará.

        El criterio de redondeo que utilizamos en este servicio es Round Half Even.




Condición Frente al IVA del receptor
                             CONDICIÓN FRENTE AL IVA

                                                                   COMPROBANTE
                                                                                     49 – Comprob.
                                                                                     de Compra de
                                                                CLASE                Bienes Usados

                                                         A/
Código                   Descripción                    ALEY*        B       C                49

    1        IVA Responsable Inscripto                      X                X

    4        IVA Sujeto Exento                                       X       X

    5        Consumidor Final                                        X       X                X

    6        Responsable Monotributo                        X                X

    7        Sujeto No Categorizado                                  X       X

    8        Proveedor del Exterior                                  X       X

    9        Cliente del Exterior                                    X       X

---

<!-- page 199 -->

    10      IVA Liberado – Ley N° 19.640                  X   X

    13      Monotributista Social                    X        X

    15      IVA No Alcanzado                              X   X

            Monotributo Trabajador
    16      Independiente Promovido                  X        X




* ALEY = “A con leyenda ‘operación sujeta a retención’”
