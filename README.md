# 🤖 Agente IA · Demo de Reportes de Producción
**NubeConnect — Demo para clientes de manufactura**

Este demo simula exactamente cómo funciona un agente de IA conectado a un ERP (Proscai).
Los datos de producción son inventados pero realistas. La IA (OpenAI) genera el reporte real.

---

## 🚀 Cómo desplegarlo en Render (5 minutos)

### Paso 1: Sube el código a GitHub
1. Crea un repositorio nuevo en github.com (puede ser privado)
2. Sube todos estos archivos tal como están

### Paso 2: Despliega en Render
1. Ve a **render.com** e inicia sesión
2. Click en **"New +"** → **"Web Service"**
3. Conecta tu repositorio de GitHub
4. Configura así:
   - **Name:** `agente-manufactura-demo`
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
5. Click **"Create Web Service"**

Render te dará una URL como: `https://agente-manufactura-demo.onrender.com`

### Paso 3: Úsalo
1. Abre la URL en el navegador
2. Ingresa tu API key de OpenAI (sk-...)
3. Click en "Generar Reporte"
4. En ~15 segundos tienes el reporte ejecutivo completo

---

## 📁 Estructura del proyecto

```
agente-demo/
├── server.js          ← El agente (Node.js + Express)
├── package.json       ← Dependencias
├── README.md          ← Este archivo
└── public/
    └── index.html     ← La interfaz visual
```

---

## 🧠 Cómo funciona

```
[Datos fake de Proscai] → [server.js] → [OpenAI API] → [Reporte en pantalla]
     (ERP simulado)         (el agente)    (la IA)        (lo que ve el cliente)
```

En producción real, los datos vendrían de:
```sql
SELECT turno, piezas_producidas, piezas_rechazadas, tiempo_paro
FROM Produccion
WHERE fecha BETWEEN '2025-03-03' AND '2025-03-09'
```

---

## 💡 Qué mostrarle al cliente

1. **"Esto son los datos que ya tiene en su Proscai"** → columna izquierda
2. **"El agente los lee automáticamente"** → presiona el botón
3. **"Esto es lo que recibe el gerente en su correo cada lunes a las 7am"** → el reporte
4. **"Todo corre en un servidor en Hetzner que nosotros administramos"** → NubeConnect
