// Picks arriesgados: más probables que no, pero con mejor cuota. Para cada mercado validado se toma la
// línea más exigente que todavía se cumple al menos «piso» de las veces; se queda con los «n» mejores.
const fs=require('fs'),R=require('path').join(__dirname,'..')+'/',M=require(R+'modelo.js'),P=require(R+'picks.js');
const ps=M.prepararPartidos(M.leerCSV(fs.readFileSync(R+'datos/partidos.csv','utf8')),2010);M.calificar(ps);
const piso=Number(process.argv[2]||0.58), techo=Number(process.argv[3]||0.65);
const T={},add=(k,ok,p)=>{const o=T[k]=T[k]||[0,0,0,0];o[0]++;o[1]+=ok;o[2]+=p;o[3]+=ok?1/p:0};
for(const p of ps){if(!p.jugado||p.temporada<2016||p.temporada>2025||p.linea==null)continue;
 const e=P.mezclar(p.pred,p.linea,p.lineaTotal,P.MEZCLA),s=M.simular(e.local,e.visita,3000,M.semillaDe(p.id),p.tipo!=='REG');const c=[];
 const g=Math.max(s.pLocal,s.pVisita);if(g>=piso&&g<techo)c.push({m:{m:'gana',eq:s.pLocal>=s.pVisita?p.local:p.visita},q:g,t:'gana'});
 for(const [eq,sg] of [[p.local,1],[p.visita,-1]]){let mejor=null;for(let h=-20.5;h<=20.5;h+=1){const r=M.cubrir(s,sg*h),q=(sg>0?r.local:r.visita);if(q>=piso&&q<techo&&(!mejor||q<mejor.q))mejor={h,q}}
  if(mejor&&Math.abs(mejor.h)!==0.5)c.push({m:{m:'handicap',eq,linea:mejor.h},q:mejor.q,t:'handicap'})}
 let mt=null;for(let l=25.5;l<=65.5;l+=1){const r=M.totales(s,l);if(r.mas>=piso&&r.mas<techo&&(!mt||r.mas<mt.q))mt={l,q:r.mas}}if(mt)c.push({m:{m:'total',mas:true,linea:mt.l},q:mt.q,t:'total más'});
 c.sort((a,b)=>b.q-a.q).slice(0,3).forEach(k=>{const ok=P.calificar(k.m,p,()=>undefined);if(ok==null)return;add('TODOS',ok,k.q);add(k.t,ok,k.q);add(String(p.temporada),ok,k.q)});}
for(const k of Object.keys(T).sort())console.log(k.padEnd(10),String(T[k][0]).padStart(5),'acertó',(T[k][1]/T[k][0]*100).toFixed(1)+'%','anunciaba',(T[k][2]/T[k][0]*100).toFixed(1)+'%','cuota justa media',(T[k][0]/T[k][2]).toFixed(2),'| devolución a cuota justa',((T[k][3]/T[k][0]-1)*100).toFixed(1)+'%');
