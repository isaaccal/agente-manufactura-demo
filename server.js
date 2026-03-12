const express = require('express');
const cors = require('cors');
const path = require('path');
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const DB = {
  semana_actual: {
    periodo: "3–9 Mar 2025",
    turnos: [
      { turno: "Matutino",   piezas_prog: 1200, piezas_ok: 1143, rechazos: 87,  paro_min: 95,  causa: "Falla compresor L3 (65min) + cambio molde (30min)" },
      { turno: "Vespertino", piezas_prog: 1100, piezas_ok: 1089, rechazos: 23,  paro_min: 18,  causa: "Ajuste de calibración" },
      { turno: "Nocturno",   piezas_prog: 900,  piezas_ok: 761,  rechazos: 44,  paro_min: 142, causa: "Corte de energía no programado" },
    ],
    inventario: [
      { material: "Resina ABS",           stock: 2340, minimo: 1500, unidad: "kg",   proveedor: "Química del Norte SA",   precio_unit: 45,  tiempo_entrega: "3 días" },
      { material: "Pigmento Negro",        stock: 180,  minimo: 200,  unidad: "kg",   proveedor: "Colorantes Industriales", precio_unit: 280, tiempo_entrega: "5 días" },
      { material: "Aditivo Estabilizador", stock: 95,   minimo: 100,  unidad: "kg",   proveedor: "Aditivos Especiales SA",  precio_unit: 520, tiempo_entrega: "7 días" },
      { material: "Cajas de Empaque",      stock: 3200, minimo: 1000, unidad: "pzas", proveedor: "Empaque y Diseño SA",     precio_unit: 8.5, tiempo_entrega: "2 días" },
    ]
  },
  semana_anterior: {
    periodo: "24 Feb–2 Mar 2025",
    turnos: [
      { turno: "Matutino",   piezas_prog: 1200, piezas_ok: 1198, rechazos: 31, paro_min: 22, causa: "Cambio de molde programado" },
      { turno: "Vespertino", piezas_prog: 1100, piezas_ok: 1095, rechazos: 19, paro_min: 25, causa: "Mantenimiento preventivo" },
      { turno: "Nocturno",   piezas_prog: 900,  piezas_ok: 891,  rechazos: 15, paro_min: 30, causa: "Limpieza de línea" },
    ]
  }
};

const TOOLS = [
  { type:"function", function:{ name:"obtener_datos_produccion", description:"Obtiene datos de producción por turno desde Proscai ERP.", parameters:{ type:"object", properties:{ semana:{type:"string",enum:["actual","anterior","ambas"]} }, required:["semana"] } } },
  { type:"function", function:{ name:"obtener_inventario", description:"Obtiene inventario de materias primas desde Proscai.", parameters:{ type:"object", properties:{}, required:[] } } },
  { type:"function", function:{ name:"generar_orden_compra", description:"Genera orden de compra para materiales bajo mínimo.", parameters:{ type:"object", properties:{ material:{type:"string"}, cantidad:{type:"number"}, justificacion:{type:"string"} }, required:["material","cantidad","justificacion"] } } },
  { type:"function", function:{ name:"comparar_semanas", description:"Compara producción semana actual vs anterior.", parameters:{ type:"object", properties:{}, required:[] } } }
];

async function ejecutarHerramienta(nombre, args) {
  if (nombre === "obtener_datos_produccion") {
    if (args.semana === "actual")   return { datos: DB.semana_actual.turnos,   periodo: DB.semana_actual.periodo };
    if (args.semana === "anterior") return { datos: DB.semana_anterior.turnos, periodo: DB.semana_anterior.periodo };
    return { actual: { datos: DB.semana_actual.turnos, periodo: DB.semana_actual.periodo }, anterior: { datos: DB.semana_anterior.turnos, periodo: DB.semana_anterior.periodo } };
  }
  if (nombre === "obtener_inventario") {
    return { inventario: DB.semana_actual.inventario, alertas: DB.semana_actual.inventario.filter(m => m.stock < m.minimo).map(m => m.material) };
  }
  if (nombre === "generar_orden_compra") {
    const mat = DB.semana_actual.inventario.find(m => m.material.toLowerCase().includes(args.material.toLowerCase()));
    if (!mat) return { error: "Material no encontrado" };
    return { folio:`OC-2025-${String(Math.floor(Math.random()*9000)+1000)}`, material:mat.material, cantidad:args.cantidad, unidad:mat.unidad, proveedor:mat.proveedor, precio_unitario:mat.precio_unit, total_mxn:(args.cantidad*mat.precio_unit).toFixed(2), tiempo_entrega:mat.tiempo_entrega, justificacion:args.justificacion, fecha:new Date().toLocaleDateString('es-MX'), estado:"GENERADA" };
  }
  if (nombre === "comparar_semanas") {
    const act = DB.semana_actual.turnos, ant = DB.semana_anterior.turnos;
    const sum = (a,k) => a.reduce((s,t)=>s+t[k],0);
    const pct = (a,b) => (((a-b)/b)*100).toFixed(1);
    return { produccion:{actual:sum(act,'piezas_ok'),anterior:sum(ant,'piezas_ok'),variacion_pct:pct(sum(act,'piezas_ok'),sum(ant,'piezas_ok'))}, rechazos:{actual:sum(act,'rechazos'),anterior:sum(ant,'rechazos'),variacion_pct:pct(sum(act,'rechazos'),sum(ant,'rechazos'))}, paros:{actual:sum(act,'paro_min'),anterior:sum(ant,'paro_min'),variacion_pct:pct(sum(act,'paro_min'),sum(ant,'paro_min'))}, periodo_actual:DB.semana_actual.periodo, periodo_anterior:DB.semana_anterior.periodo };
  }
  return { error: "Herramienta no encontrada" };
}

app.post('/api/agente', async (req, res) => {
  const { apiKey, config, instrucciones } = req.body;
  if (!apiKey?.startsWith('sk-')) return res.status(400).json({ error: 'API key inválida.' });
  const messages = [
    { role:"system", content:`Eres un agente de análisis de producción para ${config?.empresa||'Manufacturas del Norte SA'}. Usa herramientas para obtener datos reales del ERP Proscai. SIEMPRE compara con semana anterior. SIEMPRE revisa inventarios y genera órdenes de compra para materiales bajo mínimo (cantidad para 4 semanas). Sé directo con números concretos. Presenta resumen ejecutivo en markdown.` },
    { role:"user", content: instrucciones }
  ];
  const pasos = [], ordenesGeneradas = [];
  try {
    let iteraciones = 0;
    while (iteraciones < 10) {
      iteraciones++;
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${apiKey}`},
        body: JSON.stringify({ model:'gpt-4o-mini', messages, tools:TOOLS, tool_choice:'auto', max_tokens:2000, temperature:0.3 })
      });
      if (!response.ok) { const e = await response.json(); return res.status(400).json({ error: e.error?.message||'Error OpenAI' }); }
      const data = await response.json();
      const msg = data.choices[0].message;
      messages.push(msg);
      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        return res.json({ reporte:msg.content, pasos, ordenes:ordenesGeneradas, tokens:data.usage?.total_tokens||0, iteraciones });
      }
      const toolResults = [];
      for (const tc of msg.tool_calls) {
        const args = JSON.parse(tc.function.arguments);
        const resultado = await ejecutarHerramienta(tc.function.name, args);
        pasos.push({ herramienta:tc.function.name, args, resultado });
        if (tc.function.name==='generar_orden_compra' && resultado.folio) ordenesGeneradas.push(resultado);
        toolResults.push({ role:"tool", tool_call_id:tc.id, content:JSON.stringify(resultado) });
      }
      messages.push(...toolResults);
    }
    res.status(500).json({ error: 'Límite de iteraciones.' });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── EXPORTAR EXCEL ──
app.post('/api/exportar-excel', async (req, res) => {
  const { reporte, ordenes, empresa } = req.body;
  const payload = JSON.stringify({ semana_actual:DB.semana_actual, semana_anterior:DB.semana_anterior, ordenes:ordenes||[], empresa:empresa||'Manufacturas del Norte SA', reporte:reporte||'' });
  const tmpFile = path.join(os.tmpdir(), `reporte_${Date.now()}.xlsx`);
  try {
    try { execSync('python3 -c "import openpyxl"', {timeout:5000}); }
    catch { execSync('pip3 install openpyxl --break-system-packages -q', {timeout:60000}); }
    const scriptPath = path.join(__dirname, 'generate_excel.py');
    const safePayload = Buffer.from(payload).toString('base64');
    execSync(`python3 "${scriptPath}" "${safePayload}" "${tmpFile}"`, {timeout:30000});
    const fileBuffer = fs.readFileSync(tmpFile);
    fs.unlinkSync(tmpFile);
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition','attachment; filename="Reporte_Produccion_NubeConnect.xlsx"');
    res.send(fileBuffer);
  } catch(err) {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    res.status(500).json({ error:'Error generando Excel: '+err.message });
  }
});

// ── EXPORTAR PDF (HTML para print) ──
app.post('/api/exportar-pdf', async (req, res) => {
  const { reporte, ordenes, empresa } = req.body;
  const t = DB.semana_actual.turnos;
  const inv = DB.semana_actual.inventario;
  const tp = t.reduce((s,x)=>s+x.piezas_ok,0), tprog=t.reduce((s,x)=>s+x.piezas_prog,0),
        tr = t.reduce((s,x)=>s+x.rechazos,0), tpar=t.reduce((s,x)=>s+x.paro_min,0);
  const md2html = s => s ? s.replace(/## (.*)/g,'<h2>$1</h2>').replace(/\*\*(.*?)\*\*/g,'<b>$1</b>').replace(/^- (.*)/gm,'<li>$1</li>').replace(/<li>/g,'<ul><li>').replace(/<\/li>\n/g,'</li></ul>').replace(/\n/g,'<br>') : '';
  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Reporte NubeConnect</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial,sans-serif;font-size:10px;color:#1e293b;background:white}
.cover{background:#1B3A6B;color:white;padding:32px 36px}.cover h1{font-size:20px;font-weight:700;margin-bottom:6px}.cover p{font-size:10px;color:#93C5FD}
.body{padding:24px 36px}.kpi-row{display:flex;gap:10px;margin-bottom:18px}.kpi{flex:1;border-radius:6px;padding:10px;text-align:center}
.kpi.ok{background:#D1FAE5}.kpi.bad{background:#FEE2E2}.kpi-val{font-size:20px;font-weight:700;margin-bottom:2px}
.kpi.ok .kpi-val{color:#065F46}.kpi.bad .kpi-val{color:#991B1B}.kpi-lbl{font-size:8px;color:#64748B;text-transform:uppercase;letter-spacing:.05em}
.sec{background:#1E40AF;color:white;padding:6px 10px;font-size:10px;font-weight:700;border-radius:4px;margin:16px 0 7px;letter-spacing:.05em}
table{width:100%;border-collapse:collapse;margin-bottom:14px;font-size:9px}
th{background:#1B3A6B;color:white;padding:6px 7px;text-align:center}td{padding:5px 7px;border-bottom:1px solid #E2E8F0;text-align:center}
td:first-child{text-align:left}tr:nth-child(even) td{background:#F8FAFC}
.bad{color:#991B1B;font-weight:600}.ok{color:#065F46;font-weight:600}.warn{color:#92400E;font-weight:600}
.oc{border:1px solid #DBEAFE;border-radius:5px;padding:9px 11px;margin-bottom:7px;display:flex;justify-content:space-between}
.oc-folio{font-size:8px;color:#2563EB;font-weight:700}.oc-mat{font-size:11px;font-weight:700;color:#1B3A6B}.oc-det{font-size:8px;color:#64748B;margin-top:2px}
.oc-tot{font-size:15px;font-weight:700;color:#D97706;text-align:right}.md h2{font-size:11px;color:#1B3A6B;margin:12px 0 5px;border-bottom:1px solid #E2E8F0;padding-bottom:3px}
.md p,.md li{font-size:9.5px;line-height:1.6;margin-bottom:3px}.md ul{padding-left:14px}
.footer{margin-top:24px;border-top:1px solid #E2E8F0;padding-top:8px;font-size:8px;color:#94A3B8;text-align:center}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body>
<div class="cover"><h1>Reporte Ejecutivo de Producción</h1><p>${empresa||'Manufacturas del Norte SA'} · Semana ${DB.semana_actual.periodo} · Generado por Agente IA NubeConnect</p></div>
<div class="body">
<div class="kpi-row">
  <div class="kpi ${tp>=tprog*.95?'ok':'bad'}"><div class="kpi-val">${tp.toLocaleString('es-MX')}</div><div class="kpi-lbl">Piezas Producidas</div></div>
  <div class="kpi ${tp/tprog>=.95?'ok':'bad'}"><div class="kpi-val">${((tp/tprog)*100).toFixed(1)}%</div><div class="kpi-lbl">Cumplimiento</div></div>
  <div class="kpi bad"><div class="kpi-val">${tr}</div><div class="kpi-lbl">Rechazos</div></div>
  <div class="kpi bad"><div class="kpi-val">${tpar} min</div><div class="kpi-lbl">Total Paros</div></div>
</div>
<div class="sec">PRODUCCIÓN POR TURNO</div>
<table><thead><tr><th>Turno</th><th>Prog.</th><th>Producidas</th><th>Rechazos</th><th>% Rechazo</th><th>Paro min</th><th>% Cumpl.</th></tr></thead><tbody>
${t.map(x=>`<tr><td><b>${x.turno}</b></td><td>${x.piezas_prog}</td><td class="${x.piezas_ok/x.piezas_prog<.92?'bad':'ok'}">${x.piezas_ok}</td><td class="bad">${x.rechazos}</td><td>${((x.rechazos/x.piezas_ok)*100).toFixed(1)}%</td><td class="${x.paro_min>60?'bad':x.paro_min>30?'warn':''}">${x.paro_min}</td><td class="${x.piezas_ok/x.piezas_prog>=.95?'ok':'bad'}">${((x.piezas_ok/x.piezas_prog)*100).toFixed(1)}%</td></tr>`).join('')}
<tr style="background:#1B3A6B;color:white;font-weight:700"><td>TOTAL</td><td>${tprog}</td><td>${tp}</td><td>${tr}</td><td>${((tr/tp)*100).toFixed(1)}%</td><td>${tpar}</td><td>${((tp/tprog)*100).toFixed(1)}%</td></tr>
</tbody></table>
<div class="sec">INVENTARIO DE MATERIAS PRIMAS</div>
<table><thead><tr><th>Material</th><th>Stock</th><th>Mínimo</th><th>Estado</th><th>Proveedor</th></tr></thead><tbody>
${inv.map(m=>`<tr><td><b>${m.material}</b></td><td>${m.stock.toLocaleString()} ${m.unidad}</td><td>${m.minimo} ${m.unidad}</td><td class="${m.stock<m.minimo?'bad':'ok'}">${m.stock<m.minimo?'⚠ BAJO MÍNIMO':'✓ OK'}</td><td>${m.proveedor}</td></tr>`).join('')}
</tbody></table>
${ordenes&&ordenes.length?`<div class="sec">ÓRDENES DE COMPRA GENERADAS</div>${ordenes.map(o=>`<div class="oc"><div><div class="oc-folio">${o.folio}</div><div class="oc-mat">${o.material}</div><div class="oc-det">${o.cantidad} ${o.unidad||''} · ${o.proveedor} · Entrega: ${o.tiempo_entrega}</div><div class="oc-det" style="font-style:italic">${o.justificacion}</div></div><div><div class="oc-tot">$${Number(o.total_mxn).toLocaleString('es-MX')} MXN</div><div style="font-size:8px;color:#64748B;text-align:right">@$${o.precio_unitario}/${o.unidad}</div></div></div>`).join('')}`:''}
<div class="sec">ANÁLISIS DEL AGENTE IA</div><div class="md">${md2html(reporte)}</div>
<div class="footer">Reporte generado automáticamente por Agente IA · NubeConnect · nubeconnect.com · ${new Date().toLocaleString('es-MX')}</div>
</div></body></html>`;
  res.json({ html });
});

app.get('/api/datos', (req, res) => res.json(DB));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Agente v2 en puerto ${PORT}`));
