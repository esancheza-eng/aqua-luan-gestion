Aqua Luan — Dashboard (sistemaaqualuan.elhyai.com)
Panel de supervisión (admin y secretaria).
La app de asesores está en otro repo y otro dominio:
Repo: `luan_aqua_basededatos`
URL: https://aqualuanpedidos.elhyai.com
Publicar
Settings → Pages → Deploy from branch `main` / root.
Custom domain: `sistemaaqualuan.elhyai.com`
Esperar certificado SSL → Enforce HTTPS.
Firebase Authentication → Authorized domains → agregar `sistemaaqualuan.elhyai.com`
Archivos que sirve el sitio:
`index.html` (portada; debe empezar con `<!DOCTYPE html>`)
`dashboard.js`
`dashboard.css`
`logo-luanaqua.png`
`logo-icon.png`
`CNAME` (`sistemaaqualuan.elhyai.com`)
No subir `dashboard.js` con el nombre `index.html`. Eso deja el sitio en texto crudo.
Secretaria y admin entran solo aquí. Los asesores entran solo en `aqualuanpedidos.elhyai.com`.
