# WSAA — Autenticación y Autorización — Documentación (ARCA Web Services SOAP)

> **Source (authoritative):** https://www.arca.gob.ar/ws/documentacion/wsaa.asp
> **Retrieved:** 2026-07-15
> **Conversion:** Firecrawl scrape (HTML documentation page; links the spec PDF Especificacion_Tecnica_WSAA_1.2.2.pdf and dev manual WSAAmanualDev.pdf).
>
> **WARNING:** This markdown is a convenience copy for search/reference only. The
> official document at the source URL is authoritative. Exact-recovery details and
> fiscal rules MUST be verified against it before implementation.

[Evitar las herramientas de navegación y pasar al contenido](https://www.arca.gob.ar/ws/documentacion/wsaa.asp#content "Saltar al contenido")

[Ir al portal principal](https://www.arca.gob.ar/landing "Ir al portal principal")

# Web Services SOAP

Menu

- [Inicio](https://www.arca.gob.ar/ws/ "Web Services SOAP")
- [Accesos](https://www.arca.gob.ar/ws/documentacion/wsaa.asp#)  - [Programadores](https://www.arca.gob.ar/ws/programadores/ "Información básica y general")
  - [Documentación](https://www.arca.gob.ar/ws/documentacion/ "Manuales y herramientas de uso")
  - [Aplicativos](https://www.arca.gob.ar/ws/aplicativos/ "Herramientas de análisis y depuración")
- [Ayuda](https://www.arca.gob.ar/ws/menu-ayuda/ "Normativa y preguntas frecuentes")

1. [Inicio](https://www.arca.gob.ar/ws/)
2. [Documentación](https://www.arca.gob.ar/ws/documentacion/default.asp)
3. WSAA

# Documentación

Manuales y herramientas de uso

Menú de contenidos

* * *

[Arquitectura](https://www.arca.gob.ar/ws/documentacion/arquitectura-general.asp)
[Certificados](https://www.arca.gob.ar/ws/documentacion/certificados.asp)
[WSAA](https://www.arca.gob.ar/ws/documentacion/wsaa.asp)
[Autoridades certificantes](https://www.arca.gob.ar/ws/documentacion/autoridades-certificantes.asp)
[WS factura electrónica](https://www.arca.gob.ar/ws/documentacion/ws-factura-electronica.asp)
[Catálogo](https://www.arca.gob.ar/ws/documentacion/catalogo.asp)
[Cronograma TLS](https://www.arca.gob.ar/ws/documentacion/cronograma-TLS.asp)
[Servicios migrados](https://www.arca.gob.ar/ws/documentacion/servicios-migrados.asp)

## WSAA (Webservice de Autenticación y Autorización)

Para poder autenticarse ante el WSAA se requiere obtener un certificado digital X.509 emitido por la Autoridad Certificante de ARCA. La obtención de un certificado digital para usar en el entorno de testing se debe gestionar mediante la aplicación web WSASS (Autoservicio de Acceso a APIs de Homologación), que está disponible [accediendo con clave fiscal](https://auth.afip.gob.ar/contribuyente_/login.xhtml). Asimismo, para obtener un certificado digital para el entorno de producción se debe usar la aplicación web “Administrador de Certificados Digitales”.

Una vez obtenido el certificado digital, hay que asociarlo al Web Service de negocio al que se va a acceder. Esta asociación se realiza en la aplicación WSASS -para el caso del entorno de testing- o en la aplicación “Administrador de Relaciones de Clave Fiscal”, para el caso del entorno de producción.

- **Documentación**
  - [¿Cómo obtener el Certificado Digital para entorno de producción?](https://www.arca.gob.ar/ws/WSAA/wsaa_obtener_certificado_produccion.pdf)
  - [¿Cómo asociar el Certificado Digital a un WSN (Web Service de Negocio)?](https://www.arca.gob.ar/ws/WSAA/wsaa_asociar_certificado_a_wsn_produccion.pdf)
  - [Especificación Técnica del WebService de Autenticación y Autorización](https://www.arca.gob.ar/ws/WSAA/Especificacion_Tecnica_WSAA_1.2.2.pdf)
  - [Manual del Desarrollador del WSAA](https://www.arca.gob.ar/ws/WSAA/WSAAmanualDev.pdf)
- **Ejemplos de aplicaciones clientes del WSAA**





[![Descripcion de la imagen](https://www.arca.gob.ar/ws/documentacion/images/Java70.jpg)](https://www.arca.gob.ar/ws/WSAA/ejemplos/wsaa_client_java.tgz)





#### [Código fuente Java](https://www.arca.gob.ar/ws/WSAA/ejemplos/wsaa_client_java.tgz)









[![Descripcion de la imagen](https://www.arca.gob.ar/ws/documentacion/images/PHP80.jpg)](https://www.arca.gob.ar/ws/WSAA/ejemplos/wsaa-client-php.zip)





#### [Código fuente PHP](https://www.arca.gob.ar/ws/WSAA/ejemplos/wsaa-client-php.zip)









[![Descripcion de la imagen](https://www.arca.gob.ar/ws/documentacion/images/NET80.jpg)](https://www.arca.gob.ar/ws/WSAA/ejemplos/dev-wsaa-cliente-dotnet-cs.zip)





#### [Código fuente C\#](https://www.arca.gob.ar/ws/WSAA/ejemplos/dev-wsaa-cliente-dotnet-cs.zip)









[![Descripcion de la imagen](https://www.arca.gob.ar/ws/documentacion/images/NET80.jpg)](https://www.arca.gob.ar/ws/documentacion/wsaa.asp#)





#### [Código fuente VB](https://www.arca.gob.ar/ws/WSAA/ejemplos/dev-wsaa-cliente-dotnet-vb.zip)









[![Descripcion de la imagen](https://www.arca.gob.ar/ws/documentacion/images/PowerShell80.png)](https://www.arca.gob.ar/ws/documentacion/wsaa.asp#)





#### [Código fuente PowerShell](https://www.arca.gob.ar/ws/WSAA/ejemplos/dev-wsaa-cliente-powershell.zip)

- **URLs**
  - Entorno de Testing del WSAA: [https://wsaahomo.afip.gov.ar/ws/services/LoginCms](https://wsaahomo.afip.gov.ar/ws/services/LoginCms)
  - Entorno de Producción del WSAA: [https://wsaa.afip.gov.ar/ws/services/LoginCms](https://wsaa.afip.gov.ar/ws/services/LoginCms)

## Footer ARCA

[Sitio web de ARCA](https://www.arca.gob.ar/landing/ "Sitio web de ARCA")

[Ir la pagina de ARCA en Twitter](https://x.com/Arca_informa) [Conocer la pagina de ARCA en Instagram](https://www.instagram.com/arca_informa/) [Visitar la pagina de ARCA en Facebook](https://www.facebook.com/ARCAinforma) [Dirigirme a la pagina de ARCA en Linkedin](https://www.linkedin.com/company/arcaargentina/) [Navegar a la pagina de ARCA en Youtube](https://www.youtube.com/@ARCA_informa) [Navegar a la pagina de ARCA en TikTok](https://www.tiktok.com/@arcainforma) [Navegar a la pagina de ARCA en WhatsApp](https://whatsapp.com/channel/0029VaFz1Ur7z4kXZ888GJ2X) [Navegar a la pagina de ARCA en Telegram](https://t.me/AFIP_Comunica)

- [Institucional](https://www.arca.gob.ar/institucional/)
- [Denuncias](https://www.arca.gob.ar/denuncias/default.asp)
- [Contactos](https://www.arca.gob.ar/atencion/)

- [Tus derechos y obligaciones](https://www.arca.gob.ar/genericos/derechosObligaciones/default.asp)
- [Transparencia](https://www.arca.gob.ar/transparencia/derecho-informacion-publica.asp)
- [Estadísticas tributarias](https://www.arca.gob.ar/institucional/estudios/)

- [Excombatientes de Malvinas](https://www.arca.gob.ar/malvinas/)
- [Facturación apócrifa](https://servicioscf.afip.gob.ar/Facturacion/facturasApocrifas/default.aspx)
- [Constatación de comprobantes](https://serviciosweb.afip.gob.ar/genericos/comprobantes/Default.aspx)