# Historia de usuario: alta guiada de punto FEEWS

## Historia

Como monotributista o responsable inscripto que exporta servicios, quiero que
Motora me guíe para crear el punto de venta correcto dentro de ARCA sin entregar
mi Clave Fiscal, para que luego Motora pueda comprobarlo por WSFEX y emitir
Factura E con mi aprobación.

## Cuándo aparece

La historia comienza cuando el step engine está en
`point_of_sale_creation` porque la consulta previa no encontró un punto de
exportación compatible. La pantalla debe explicar que esto bloquea la emisión,
pero no debe describir al usuario como “no compliant”.

## Recorrido humano

1. Motora muestra el resultado: `0 puntos FEEWS activos`.
2. El usuario abre el servicio oficial “Administración de puntos de venta y
   domicilios” en una pestaña aislada y se autentica directamente con ARCA.
3. Motora guía las opciones visibles: persona representada → “A/B/M Puntos de
   venta” → “Agregar”.
4. El usuario elige un número libre de cinco dígitos y el sistema
   “Comprobantes de Exportación - Webservices”.
5. El usuario elige su domicilio, guarda con “Aceptar”, vuelve a Motora e
   informa solamente el número público del punto.
6. Motora registra la confirmación del alta y avanza a `ws_delegation`; tampoco
   da por verificado el punto con esa declaración humana.
7. Después de la delegación, `api_verification` consulta
   `FEXGetPARAM_PtoVenta` mediante el signer. Sólo un recibo WSFEX enlazado al
   mismo workspace, issuer profile y compromiso del CUIT permite continuar hacia
   evidencia/`ready` según el estado real del run.

## Selectores

- Alcance: `Exportación` o `Exportación + mercado local`.
- Si ARCA devuelve más de un punto FEEWS activo: selector explícito del punto;
  Motora nunca elige silenciosamente.
- Si devuelve cero: campo de cinco dígitos para registrar el punto recién
  creado. El sistema de emisión se muestra bloqueado como referencia, no como
  selector editable.
- Domicilio: se elige exclusivamente dentro de ARCA; Motora no copia ni retiene
  el catálogo de domicilios durante este handoff.

## Criterios de aceptación

- La pantalla indica el menú y sistema de emisión exactos y distingue
  Webservices de Comprobantes en Línea y Facturador Plus.
- El enlace abre un origen oficial en una pestaña aislada con
  `noopener noreferrer`.
- CUIT, Clave Fiscal, cookies, CAPTCHA, token/sign, certificado y clave privada
  nunca se solicitan en la interfaz de Motora.
- El punto acepta únicamente `00001`–`99998`.
- El botón de verificación permanece deshabilitado hasta que el número sea
  válido y el usuario confirme que guardó el alta en ARCA.
- La confirmación humana produce un estado pendiente, nunca `ready`.
- Una respuesta vacía o que no incluya el punto seleccionado mantiene el run
  bloqueado.
- Una respuesta perteneciente a otro issuer profile o CUIT representado se
  rechaza.
- Reclaim puede probar los hechos mínimos observados en el portal, pero no
  completa `api_verification` ni autoriza una factura.

## Copy de recuperación

- ARCA todavía no lo muestra: “Esperá unos minutos y volvé a verificar. No crees
  otro punto mientras el alta pueda estar propagándose”.
- Número distinto: “El punto guardado en ARCA no coincide con el informado.
  Revisá los cinco dígitos”.
- Sistema incorrecto: “Ese punto no está habilitado para Comprobantes de
  Exportación - Webservices. Podés conservarlo para su uso original y crear otro
  para WSFEX”.
- Sesión cerrada: “Volvé a abrir ARCA. Motora no puede recuperar ni renovar tu
  sesión”.

## Evidencia de producto

La UI puede conservar únicamente el número seleccionado, hashes de recibos,
timestamps y estados del step engine. El recibo oficial y la prueba Reclaim
siguen políticas separadas de custodia y retención.
