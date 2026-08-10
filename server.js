const http=require('http');
const fs=require('fs');
const path=require('path');
const {URL}=require('url');

const PORT=Number(process.env.PORT||8787);
const BINANCE=process.env.BINANCE_BASE_URL||'https://fapi.binance.com';
const PUBLIC=path.join(__dirname,'public');
const DATA=path.join(__dirname,'data');
const SIGNALS=path.join(DATA,'signals.jsonl');
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8'};

fs.mkdirSync(DATA,{recursive:true});
function json(res,status,obj){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'*'});res.end(JSON.stringify(obj))}
function body(req){return new Promise((resolve,reject)=>{let b='';req.on('data',c=>{b+=c;if(b.length>2e6)reject(Error('body too large'))});req.on('end',()=>{try{resolve(b?JSON.parse(b):{})}catch(e){reject(e)}});req.on('error',reject)})}
async function fetchBinance(route){
 const r=await fetch(BINANCE+route,{headers:{accept:'application/json'}});
 const text=await r.text();let data;try{data=JSON.parse(text)}catch{data={message:text}}
 if(!r.ok)throw Object.assign(Error(data.msg||data.message||`HTTP ${r.status}`),{status:r.status});
 return data;
}
function features(k){
 const c=k.map(x=>+x[4]),v=k.map(x=>+x[5]);
 const ret=(n)=>{const a=c.at(-1),b=c[Math.max(0,c.length-1-n)];return b?(a/b-1):0};
 const mean=a=>a.reduce((x,y)=>x+y,0)/a.length;
 const sd=a=>{const m=mean(a);return Math.sqrt(mean(a.map(x=>(x-m)**2)))||1};
 const rvol=v.at(-1)/(mean(v.slice(-21,-1))||1);
 const volz=(v.at(-1)-mean(v.slice(-21,-1)))/sd(v.slice(-21,-1));
 const hh=Math.max(...k.slice(-24).map(x=>+x[2])),ll=Math.min(...k.slice(-24).map(x=>+x[3])),price=c.at(-1);
 const range=(hh-ll)/price;
 const pos=(price-ll)/(hh-ll||1);
 const atr=mean(k.slice(-14).map(x=>+x[2]-+x[3]))/price;
 return [ret(1),ret(4),ret(8),ret(16),rvol,volz,range,pos,atr];
}
function logisticTrain(X,y,epochs=700,lr=.08){
 const n=X.length,p=X[0].length;let w=Array(p+1).fill(0);
 for(let e=0;e<epochs;e++){
   const g=Array(p+1).fill(0);
   for(let i=0;i<n;i++){let z=w[0];for(let j=0;j<p;j++)z+=w[j+1]*X[i][j];const q=1/(1+Math.exp(-Math.max(-30,Math.min(30,z)))),d=q-y[i];g[0]+=d;for(let j=0;j<p;j++)g[j+1]+=d*X[i][j]}
   for(let j=0;j<w.length;j++)w[j]-=lr*g[j]/n;
 }
 return w;
}
function auc(y,p){
 const pairs=y.map((v,i)=>[p[i],v]).sort((a,b)=>a[0]-b[0]);
 let rank=0,pos=0,neg=0;for(const x of pairs){if(x[1]){pos++;rank+=pairs.indexOf(x)+1}else neg++}
 return pos&&neg?(rank-pos*(pos+1)/2)/(pos*neg):null;
}
async function train(bodyObj){
 const symbols=Array.isArray(bodyObj.symbols)?bodyObj.symbols.slice(0,12):['BTCUSDT'];
 const days=Math.min(Number(bodyObj.days||30),180), horizon=Math.min(Number(bodyObj.horizonBars||8),48);
 const interval=bodyObj.interval||'15m', stepMs=15*60*1000, end=Date.now(), start=end-days*86400000;
 const X=[],Y=[];
 for(const symbol of symbols){
   let cursor=start;
   while(cursor<end){
     const batch=await fetchBinance(`/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&startTime=${cursor}&limit=1000`);
     if(!Array.isArray(batch)||!batch.length)break;
     for(let i=96;i<batch.length-horizon;i++){
       const sample=batch.slice(0,i+1), f=features(sample);
       const entry=+batch[i][4], future=batch.slice(i+1,i+1+horizon);
       const hi=Math.max(...future.map(x=>+x[2])), lo=Math.min(...future.map(x=>+x[3]));
       const up=(hi/entry-1)>=0.02, down=(1-lo/entry)>=0.02;
       const label=up&&!down?1:0;
       X.push(f);Y.push(label);
     }
     const last=+batch.at(-1)[0];if(last<=cursor)break;cursor=last+stepMs;
     if(batch.length<1000)break;
   }
 }
 if(X.length<100)throw Error(`Nur ${X.length} Samples. Mindestens 100 benötigt.`);
 const split=Math.floor(X.length*.8), trainX=X.slice(0,split),trainY=Y.slice(0,split),testX=X.slice(split),testY=Y.slice(split);
 const w=logisticTrain(trainX,trainY);
 const pred=testX.map(f=>1/(1+Math.exp(-Math.max(-30,Math.min(30,w[0]+w.slice(1).reduce((s,x,j)=>s+x*f[j],0))))));
 const base=Y.reduce((a,b)=>a+b,0)/Y.length;
 return {samples:X.length,trainSamples:trainX.length,testSamples:testX.length,baseRate:base,auc:auc(testY,pred),weights:w,features:['ret1','ret4','ret8','ret16','rvol','volz','range','position','atrPct'],method:'logistic regression',note:'Price/volume historical calibration only. It is a research layer, not a proven trading edge.',trainedAt:new Date().toISOString()};
}
const server=http.createServer(async(req,res)=>{
 const u=new URL(req.url,`http://${req.headers.host||'127.0.0.1'}`);
 try{
   if(req.method==='GET'&&u.pathname.startsWith('/api/binance/')){
     const route=u.pathname.replace('/api/binance','')+u.search;
     const data=await fetchBinance(route);return json(res,200,data);
   }
   if(req.method==='POST'&&u.pathname==='/api/signals'){
     const b=await body(req);fs.appendFileSync(SIGNALS,JSON.stringify({...b,serverTime:Date.now()})+'\\n');return json(res,200,{ok:true});
   }
   if(req.method==='GET'&&u.pathname==='/api/signals'){
     const lines=fs.existsSync(SIGNALS)?fs.readFileSync(SIGNALS,'utf8').trim().split('\\n').filter(Boolean):[];
     return json(res,200,lines.slice(-2000).map(x=>JSON.parse(x)));
   }
   if(req.method==='POST'&&u.pathname==='/api/train'){
     const b=await body(req);const result=await train(b);return json(res,200,result);
   }
   if(req.method==='GET'){
     let file=u.pathname==='/'?'/index.html':u.pathname;
     file=path.normalize(file).replace(/^(\.\.[\/\\])+/, '');
     const fp=path.join(PUBLIC,file);if(!fp.startsWith(PUBLIC))return res.end('Forbidden');
     return fs.readFile(fp,(e,d)=>{if(e){res.writeHead(404);return res.end('Not Found')}res.writeHead(200,{'Content-Type':MIME[path.extname(fp)]||'application/octet-stream','Cache-Control':'no-store'});res.end(d)});
   }
   res.writeHead(404);res.end('Not Found');
 }catch(e){json(res,e.status||500,{error:'SERVER_ERROR',message:e.message||String(e)})}
});
server.listen(PORT,'127.0.0.1',()=>console.log(`PULSE V2.1 Quant → http://127.0.0.1:${PORT}`));
