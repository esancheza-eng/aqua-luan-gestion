# Aqua Luan — Dashboard (sistemaaqualuan.elhyai.com)

Panel de supervisión (admin y secretaria).

La app de asesores está en otro repo y otro dominio:

- Repo: `luan_aqua_basededatos`
- URL: https://aqualuanpedidos.elhyai.com

## Publicar

1. Settings → Pages → Deploy from branch `main` / root.
2. Custom domain: `sistemaaqualuan.elhyai.com`
3. Esperar certificado SSL → Enforce HTTPS.
4. Firebase Authentication → Authorized domains → agregar `sistemaaqualuan.elhyai.com`
5. Archivos del sitio: `index.html`, `dashboard.js`, `dashboard.css`, `logo-luanaqua.png`, `logo-icon.png`, `CNAME`
6. `index.html` debe empezar con `<!DOCTYPE html>`. Nunca subas `dashboard.js` con ese nombre.
7. Secretaria y admin entran solo aquí. Los asesores entran solo en https://aqualuanpedidos.elhyai.com
