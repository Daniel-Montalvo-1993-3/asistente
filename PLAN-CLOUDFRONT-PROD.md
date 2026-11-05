# Plan CloudFront → Producción (revistamoi) — basado en la prueba de staging

Fecha: 2026-11-05 · Estado: borrador para revisión (nada de esto se ha ejecutado en prod)

---

## 1. Qué cambió respecto al plan original

El plan original asume que **no hay CDN delante de WordPress** y propone crear una distribución nueva + cambiar DNS. Al revisar producción, eso **no es cierto**:

| Hallazgo (verificado en la cuenta) | Valor |
|---|---|
| revistamoi.com y www ya apuntan (DNS Alias) a CloudFront | `E3KNS8W8L1DZAA` (`d2s2ydzax91hgc.cloudfront.net`) |
| Aliases de esa distribución | `revistamoi.com`, `www.revistamoi.com`, `*.revistamoi.com` |
| Origen | ALB prod `revist-WebAp-cahQV9R7gWQv`, `https-only` |
| WAF | Sí: `CreatedByCloudFront-275efe2a` |
| Política de caché (default) | `UseOriginCacheControlHeaders` (83da9c7e…) |
| Behaviors adicionales | **Ninguno** |
| Un CSS en prod, 2 pedidos seguidos | `X-Cache: Miss` ambas veces, sin `Cache-Control` |

**Causa raíz probable del gasto de EFS:** la distribución existente solo respeta el `Cache-Control` que manda WordPress/Apache, y los estáticos **no traen ese header**, así que CloudFront **nunca los cachea** y cada request llega al origen y lee de EFS.

**Consecuencia:** no hay que crear una distribución nueva ni tocar DNS ni certificados. Hay que **modificar la distribución existente agregando behaviors de caché para estáticos**. Es más simple y de menor riesgo que el plan original.

---

## 2. Qué validó la prueba de staging

Distribución de prueba `E1S6FHEZFFTDI0` (`d3t4h5o67au8g.cloudfront.net`):

- `.css` con `CachingOptimized`: `Miss → Hit → Hit` ✓
- Home, `/wp-login.php`, `/wp-admin/` con `CachingDisabled`: no se cachean ✓
- Redirección HTTP→HTTPS ✓
- El target group de staging se estabilizó alineándolo con prod (`/wp-login.php`, timeout 100s)

Limitaciones de la prueba (no extrapolar):
- Staging no monta EFS y casi no tiene tráfico → **el ahorro de EFS solo se puede medir en prod**.
- Staging usó origen `http-only` por el certificado; **prod ya usa `https-only` y funciona**, no cambiar.

---

## 3. Correcciones al plan original

1. ID de `CachingDisabled` incorrecto en el plan. Correcto: `4135ea2d-6df8-44a3-9df3-4b5a84be39ad`.
2. `OriginSslProtocols` no acepta `TLSv1.3` (solo `TLSv1.2` como máximo).
3. Crear distribución nueva + cambio de DNS **no aplica** a revistamoi (ya existe). Se modifica la existente.
4. El tramo de origen: mantener `https-only` en prod (ya funciona con el cert `*.revistamoi.com`).

---

## 4. Riesgo técnico a resolver ANTES de aplicar

**Query strings (`?ver=6.1.6`).** `CachingOptimized` **ignora query strings** en la llave de caché. WordPress versiona assets así (`styles.css?ver=1.0`). Si se actualiza un plugin/tema, CloudFront seguiría sirviendo el CSS/JS viejo hasta 24 h (TTL por defecto) y puede romper el sitio visualmente.

Mitigación (elegir una):
- **A (recomendada):** crear una cache policy propia que **incluya query strings** en la llave, TTL default 1 día, max 1 año, gzip+brotli. Evita assets viejos tras actualizaciones.
- B: usar `CachingOptimized` y hacer invalidación `/wp-content/*` en cada despliegue/actualización de plugins (más frágil).

Otros puntos a revisar:
- Imagen en staging devolvió `302` (regla de WordPress/Apache); verificar que en prod `/wp-content/uploads/*` responda `200` directo, porque un 302 cacheado/mal manejado confunde.
- 22 recursos con `http://` en staging (contenido mixto). Prod ya sirve por HTTPS, pero **verificar** que el HTML de prod no emita `http://` (revisar HTML y `wp-config.php` con `X-Forwarded-Proto`).

---

## 5. Procedimiento propuesto (revistamoi, piloto)

### Fase 0 — Preparación (sin impacto) · ~1 h
- [ ] Respaldar la config actual: `aws cloudfront get-distribution-config --id E3KNS8W8L1DZAA > backup-E3KNS8W8L1DZAA-<fecha>.json` (guardar también el ETag).
- [ ] Medir la línea base de EFS (`fs-03d181fd8ee00c76d`): `DataReadIOBytes`/`TotalIOBytes` de los últimos 7 días, por hora.
- [ ] Habilitar métricas adicionales de CloudFront (para `CacheHitRate`) en la distribución, o usar logs.
- [ ] Revisar HTML de prod en busca de `http://` y la config de HTTPS en `wp-config.php`.
- [ ] Confirmar que existe una ventana de bajo tráfico (aunque no hay cambio de DNS).
- [ ] Decidir A o B del punto 4 y crear la cache policy si se elige A.

### Fase 1 — Aplicar behaviors en la distribución existente · ~30 min + despliegue ~3-15 min
Agregar a `E3KNS8W8L1DZAA` los behaviors (mismo set probado en staging), apuntando al origen existente, con la cache policy del punto 4:

`*.css`, `*.js`, `*.jpg`, `*.png`, `*.webp`, `*.woff2`, `/wp-content/uploads/*`, `/wp-content/themes/*`
(candidatos para después: `*.svg`, `*.gif`, `*.ico`, `*.woff`, `/wp-content/plugins/*`, `/wp-includes/*`)

Reglas:
- **No modificar** el default behavior, el WAF, los aliases, el certificado ni el origen.
- Solo métodos `GET/HEAD` en estos behaviors.
- Hacerlo con `update-distribution` usando el JSON respaldado + ETag (cambio aditivo).
- Los behaviors más específicos (`/wp-content/...`) deben ir antes que los genéricos (`*.css`) si se quiere comportamiento distinto; con la misma policy el orden no cambia el resultado.

### Fase 2 — Verificación inmediata · ~20 min
Contra `https://revistamoi.com` (y opcionalmente contra `d2s2ydzax91hgc.cloudfront.net`):
- [ ] CSS/JS/imagen: `Miss` en la 1ª, `Hit` en la 2ª.
- [ ] Home, `/wp-login.php`, `/wp-admin/`, `/wp-json/`: siguen **sin** cachearse (`Miss`/`Error` no-hit).
- [ ] Sitio carga completo en navegador, sin contenido mixto ni errores de consola/CORS.
- [ ] Login de admin y usuario logueado funcionan.
- [ ] Sin aumento de 5xx.

### Fase 3 — Monitoreo 48–72 h
- [ ] `CacheHitRate` objetivo: >50 % a 1 h, 60–70 % a 24 h (de estáticos).
- [ ] `DataReadIOBytes` de EFS vs. línea base: debe bajar.
- [ ] `5xxErrorRate` < 1 %; alarmas en CloudWatch (5xx y hit rate bajo).
- [ ] Costo de CloudFront dentro de lo estimado.

### Fase 4 — Replicar a los demás sitios (tras éxito del piloto)
Estado preliminar detectado (hay que **verificar cada uno**, no asumir):

| Sitio | Señal observada | Acción probable |
|---|---|---|
| marthadebayle.com | Ya pasa por CloudFront (`Miss`) | Igual que revistamoi: agregar behaviors |
| bbmundo.com | Ya pasa por CloudFront (`Miss`) | Igual |
| bbmundoacademy.com | Ya pasa por CloudFront (`Hit`) | Revisar qué ya cachea, ajustar |
| mdbpodcasts.com | Sin header de CloudFront | Posiblemente distribución nueva + DNS (flujo del plan original) |
| nuevamenopausia.com | Sin header de CloudFront | Posiblemente distribución nueva + DNS |

Para cada sitio: identificar distribución, auditar behaviors/policy actuales, aplicar el mismo patrón. Orden sugerido por tamaño de EFS (marthadebayle → bbmundo → bbmundoacademy → resto).

---

## 6. Rollback (todos los pasos son aditivos y reversibles)

Si algo sale mal tras la Fase 1:
1. Restaurar la config respaldada: `aws cloudfront update-distribution --id E3KNS8W8L1DZAA --if-match <ETAG_ACTUAL> --distribution-config file://backup-...json` (se necesita el ETag **vigente**, no el del respaldo).
2. Alternativa rápida: quitar solo los behaviors nuevos.
3. Si hay contenido viejo servido: `create-invalidation --paths "/wp-content/*" "/*.css" "/*.js"`.

No hay cambio de DNS, así que no hay propagación de por medio. El despliegue de CloudFront toma minutos.

---

## 7. ¿Se cae el sitio?

No se espera caída: el cambio es aditivo sobre una distribución que ya sirve el tráfico, sin tocar DNS, certificado, WAF, origen ni servidores. Riesgos reales (de comportamiento, no de disponibilidad):
- Assets viejos por query strings ignorados (mitigado con cache policy propia, punto 4).
- Cachear algo dinámico por error (mitigado: solo extensiones estáticas y rutas de contenido).
- Costo de CloudFront algo mayor (se compensa con la baja de EFS; verificar en Cost Explorer a 1 semana y 1 mes).

---

## 8. Pendientes de limpieza / recomendaciones

- [ ] Staging: distribución de prueba `E1S6FHEZFFTDI0` sigue activa → deshabilitar y borrar cuando se cierre la validación.
- [ ] Staging: el health check del target group se cambió por CLI (**drift** con CloudFormation `revistamoi-staging`); actualizar la plantilla o se revertirá en el próximo `update-stack`.
- [ ] Actualizar el plan original con las correcciones de la sección 3.
- [ ] Evaluar cambio de modo de rendimiento de EFS solo después de ≥1 semana de datos (fase 3 del plan original).

---

## 9. Estimación de tiempo

| Fase | Duración |
|---|---|
| 0. Preparación | ~1 h |
| 1. Aplicar behaviors | ~30 min + despliegue |
| 2. Verificación | ~20 min |
| 3. Monitoreo | 48–72 h (pasivo) |
| 4. Resto de sitios | ~1 h por sitio |
