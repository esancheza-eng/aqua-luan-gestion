# Aqua Luan — Dashboard (gestion.elhyai.com)

Panel de supervisión (admin y secretaria).
La app de asesores sigue en https://aqualuanpedidos.elhyai.com

## Publicar
1. Settings → Pages → Deploy from branch `main` / root.
2. Custom domain: `sistemaaqualuan.elhyai.com`
3. Esperar certificado SSL → Enforce HTTPS.
4. Firebase Authentication → Authorized domains → agregar `sistemaaqualuan.elhyai.com`
5. Subir aquí: dashboard.html, dashboard.js, dashboard.css, logo-luanaqua.png, logo-icon.png
6. En la app (repo luan_aqua_basededatos) cambiar `location.href = 'dashboard.html'` a `https://sistemaaqualuan.elhyai.com`
