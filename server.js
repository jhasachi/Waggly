const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {WagglyStorage, StorageConflictError, StorageVersionError} = require('./storage');

const ROOT = __dirname;
const DATA_DIR = path.resolve(process.env.WAGGLY_DATA_DIR || path.join(ROOT, 'data'));
const DB_FILE = path.join(DATA_DIR, 'waggly.sqlite');
const LEGACY_DB_FILE = path.join(DATA_DIR, 'waggly.json');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const TZ = 'Europe/Prague';
const STAFF_PASSWORD = process.env.STAFF_PASSWORD || 'waggly-demo';
if(process.env.NODE_ENV==='production'&&STAFF_PASSWORD==='waggly-demo')throw new Error('Set a unique STAFF_PASSWORD before starting Waggly in production.');
const initialServices = [
  {id:'full-groom',name:'Full Grooming',price:900,description:'A fresh, feel good reset from nose to tail.',details:['Bathing','Drying','Haircut','Brushing','Basic hygiene care'],duration:120,active:true,icon:'✂️'},
  {id:'bath-brush',name:'Bath & Brush',price:550,description:'A warm bath and a beautifully brushed coat.',details:['Bathing','Drying','Brushing'],duration:75,active:true,icon:'🫧'},
  {id:'nail-trim',name:'Nail Trimming',price:200,description:'A gentle paw tidy for happy little steps.',details:['Nail clipping','Basic paw care'],duration:30,active:true,icon:'🐾'},
  {id:'puppy-groom',name:'Puppy Grooming',price:650,description:'A calm, gentle first introduction to grooming.',details:['Gentle bathing','Light brushing','Introduction to grooming'],duration:75,active:true,icon:'🐶'},
  {id:'ear-clean',name:'Ear Cleaning',price:150,description:'A quick, careful clean to keep ears comfy.',details:['Basic ear cleaning'],duration:20,active:true,icon:'💛'}
];
const storage = new WagglyStorage({file:DB_FILE,legacyFile:LEGACY_DB_FILE,initialServices,hours:{open:'09:00',close:'17:00',step:30}});
function db(){return storage.read()}
function save(data){storage.write(data)}
const sessions = new Map();
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg'};
function json(res,code,obj){res.writeHead(code,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(obj))}
function body(req){return new Promise((resolve,reject)=>{let chunks=[],length=0,failed=false;req.on('data',chunk=>{length+=chunk.length;if(length>100_000){if(!failed){failed=true;reject(Object.assign(Error('Request body is too large.'),{statusCode:413}))}return}chunks.push(chunk)});req.on('end',()=>{if(failed)return;try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');if(!value||typeof value!=='object'||Array.isArray(value))throw Error();resolve(value)}catch{reject(Object.assign(Error('Invalid JSON request.'),{statusCode:400}))}});req.on('error',reject)})}
function text(value,max){return typeof value==='string'?value.trim().slice(0,max):''}
function cookie(req,key){const c=(req.headers.cookie||'').split('; ').find(x=>x.startsWith(key+'='));return c?decodeURIComponent(c.slice(key.length+1)):''}
function staff(req){const token=cookie(req,'waggly_staff');const record=sessions.get(token);return !!record&&record> Date.now()}
function sessionToken(){const id=crypto.randomBytes(32).toString('hex');sessions.set(id,Date.now()+12*60*60*1000);return id}
function secureToken(){return crypto.randomBytes(32).toString('hex')}
function ref(){return 'WG-'+new Date().getFullYear()+'-'+crypto.randomBytes(3).toString('hex').toUpperCase()}
function esc(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function dateAt(date,time){const [y,mo,d]=date.split('-').map(Number),[h,m]=time.split(':').map(Number);const desired=Date.UTC(y,mo-1,d,h,m);let stamp=desired;for(let i=0;i<2;i++){const parts=new Intl.DateTimeFormat('en-GB',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(stamp));const v=Object.fromEntries(parts.map(p=>[p.type,p.value]));stamp=desired-(Date.UTC(+v.year,+v.month-1,+v.day,+v.hour,+v.minute)-stamp)}return new Date(stamp)}
function active(b){return ['PENDING','CONFIRMED','IN_PROGRESS','COMPLETED'].includes(b.status)}
function serviceSelection(ids,data){const unique=[...new Set((Array.isArray(ids)?ids:[]).filter(id=>typeof id==='string'))];if(!unique.length||unique.length>5)return[];return unique.map(id=>data.services.find(s=>s.id===id&&s.active)).filter(Boolean).length===unique.length?unique.map(id=>data.services.find(s=>s.id===id&&s.active)):[]}
function selectionDuration(services){return services.reduce((sum,s)=>sum+(Number(s.duration)||60),0)}
function conflicts(date,time,duration,data,excludeId){const start=dateAt(date,time).getTime(),end=start+duration*60000;if(data.blockedSlots.some(key=>{const [day,at]=key.split(' ');if(day!==date||!at)return false;const from=dateAt(day,at).getTime();return start<from+data.hours.step*60000&&end>from}))return true;return data.bookings.some(b=>{if(!active(b)||b.id===excludeId)return false;const dur=Number(b.duration)||Number(data.services.find(s=>s.id===b.serviceId)?.duration)||60;return b.date===date&&b.time&&start<dateAt(b.date,b.time).getTime()+dur*60000&&end>dateAt(b.date,b.time).getTime()})}
function slotList(date,data,duration=30,excludeId){if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return[];let d;try{d=dateAt(date,'12:00')}catch{return[]}if(Number.isNaN(d.getTime())||new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(d)!==date||new Intl.DateTimeFormat('en-US',{timeZone:TZ,weekday:'short'}).format(d)==='Sun')return[];const out=[];let [h,m]=data.hours.open.split(':').map(Number);const [eh,em]=data.hours.close.split(':').map(Number);while(h*60+m+duration<=eh*60+em){const t=`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;const start=dateAt(date,t);const available=!conflicts(date,t,duration,data,excludeId);if(start>Date.now()&&available)out.push(t);m+=data.hours.step;h+=Math.floor(m/60);m%=60}return out}
async function main(req,res){
  const url=new URL(req.url,`http://${req.headers.host||'localhost'}`),p=url.pathname;
  if(p.startsWith('/api/')){
    if(req.method==='GET'&&p==='/api/services')return json(res,200,db().services.filter(s=>s.active));
    if(req.method==='GET'&&p==='/api/slots'){const date=url.searchParams.get('date')||'',d=db(),ids=(url.searchParams.get('serviceIds')||url.searchParams.get('serviceId')||'').split(',').filter(Boolean),selected=serviceSelection(ids,d),requestedDuration=Number(url.searchParams.get('duration')),duration=requestedDuration>=15&&requestedDuration<=600?requestedDuration:selected.length?selectionDuration(selected):30;return json(res,200,slotList(date,d,duration))}
    if(req.method==='POST'&&p==='/api/bookings'){
      const x=await body(req),ids=Array.isArray(x.serviceIds)?x.serviceIds:[x.serviceId];
      for(const [field,label,max] of [['petName','Pet name',80],['petSize','Pet size',20],['name','Full name',100]])if(typeof x[field]!=='string'||!x[field].trim()||x[field].length>max)return json(res,400,{error:`Please enter a valid ${label.toLowerCase()}.`});
      if(!['Small','Medium','Large','Extra large'].includes(x.petSize))return json(res,400,{error:'Please choose a valid pet size.'});
      const requestKey=x.requestKey||req.headers['idempotency-key']||crypto.randomUUID();
      if(typeof requestKey!=='string'||requestKey.length<8||requestKey.length>120)return json(res,400,{error:'Please refresh the booking form and try again.'});
      const result=storage.createBooking(requestKey,current=>{
        const services=serviceSelection(ids,current);
        if(!services.length||services.length!==ids.length)throw Object.assign(new Error('Please choose one or more available services.'),{statusCode:400});
        const duration=selectionDuration(services);
        if(!slotList(x.date,current,duration).includes(x.time))return null;
        return {id:crypto.randomUUID(),reference:ref(),token:secureToken(),serviceId:services[0].id,serviceIds:services.map(s=>s.id),services:services.map(s=>s.name),service:services.map(s=>s.name).join(' + '),price:services.reduce((sum,s)=>sum+s.price,0),duration,petName:text(x.petName,80),petSize:x.petSize,breed:text(x.breed,80),age:text(x.age,40),needs:text(x.needs,500),date:x.date,time:x.time,name:text(x.name,100),phone:text(x.phone,40),comments:text(x.comments,1000),status:'PENDING',createdAt:new Date().toISOString()};
      });
      if(!result.booking)return json(res,409,{error:'That time has just been taken. Please choose another slot.'});
      const b=result.booking;
      return json(res,result.duplicate?200:201,{reference:b.reference,token:b.token,duplicate:result.duplicate});
    }
    if(req.method==='GET'&&/^\/api\/manage\/[a-f0-9]{64}$/.test(p)){const b=db().bookings.find(x=>x.token===p.split('/')[3]);if(!b)return json(res,404,{error:'We could not find this booking link.'});const {token,...safe}=b;return json(res,200,safe)}
    if(req.method==='POST'&&p==='/api/staff/login'){const x=await body(req);if(!process.env.STAFF_PASSWORD&&STAFF_PASSWORD==='waggly-demo')console.warn('Using demo staff password. Set STAFF_PASSWORD before deployment.');if(typeof x.password!=='string'||x.password.length>200||!crypto.timingSafeEqual(Buffer.from(crypto.createHash('sha256').update(x.password).digest()),Buffer.from(crypto.createHash('sha256').update(STAFF_PASSWORD).digest())))return json(res,401,{error:'That password did not match.'});const id=sessionToken();res.setHeader('Set-Cookie',`waggly_staff=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${process.env.NODE_ENV==='production'?'; Secure':''}`);return json(res,200,{ok:true})}
    if(p.startsWith('/api/staff/')&&!staff(req))return json(res,401,{error:'Please sign in to the staff area.'});
    if(req.method==='POST'&&p==='/api/staff/logout'){const id=cookie(req,'waggly_staff');sessions.delete(id);res.setHeader('Set-Cookie','waggly_staff=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return json(res,200,{ok:true})}
    if(req.method==='GET'&&p==='/api/staff/bookings')return json(res,200,db().bookings.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)));
    if(req.method==='GET'&&p==='/api/staff/settings'){const d=db();return json(res,200,{services:d.services,hours:d.hours,blockedSlots:d.blockedSlots})}
    if(req.method==='POST'&&p==='/api/staff/action'){
      const x=await body(req),d=db(),b=d.bookings.find(a=>a.id===x.id);if(!b)return json(res,404,{error:'Booking not found.'});
      if(x.action==='accept'&&b.status==='PENDING')b.status='CONFIRMED';else if(x.action==='reject'&&b.status==='PENDING'){b.status='REJECTED';b.reason=text(x.reason,500)}else if(x.action==='start'&&b.status==='CONFIRMED')b.status='IN_PROGRESS';else if(x.action==='complete'&&b.status==='IN_PROGRESS')b.status='COMPLETED';else return json(res,409,{error:'This action is not available for the current status.'});
      save(d);return json(res,200,{ok:true,status:b.status});
    }
    if(req.method==='POST'&&p==='/api/staff/service'){const x=await body(req),d=db();if(!text(x.name,70)||!Number.isFinite(Number(x.price))||Number(x.price)<0)return json(res,400,{error:'Enter a service name and a valid price.'});if(x.id){const s=d.services.find(a=>a.id===x.id);if(!s)return json(res,404,{error:'Service not found.'});Object.assign(s,{name:text(x.name,70),description:text(x.description,240),price:Number(x.price),duration:Math.max(15,Math.min(240,Number(x.duration)||60)),active:!!x.active})}else d.services.push({id:crypto.randomUUID(),name:text(x.name,70),description:text(x.description,240),price:Number(x.price),duration:60,details:[],active:true,icon:'🐾'});save(d);return json(res,200,{ok:true})}
    if(req.method==='POST'&&p==='/api/staff/slots'){const x=await body(req),d=db();if(!/^\d{4}-\d{2}-\d{2}$/.test(x.date)||!/^\d{2}:\d{2}$/.test(x.time))return json(res,400,{error:'Choose a valid date and time.'});const key=`${x.date} ${x.time}`;if(d.blockedSlots.includes(key))d.blockedSlots=d.blockedSlots.filter(a=>a!==key);else d.blockedSlots.push(key);save(d);return json(res,200,{ok:true,blocked:d.blockedSlots.includes(key)})}
    return json(res,404,{error:'Not found.'})
  }
  if(req.method==='GET'&&p.startsWith('/manage/'))return serve(res,'manage.html');
  if(req.method==='GET'&&(p==='/staff'||p==='/staff/'))return serve(res,'staff.html');
  if(req.method==='GET'&&(p==='/my-bookings'||p==='/my-bookings/'))return serve(res,'my-bookings.html');
  if(req.method==='GET'&&(p==='/'||p==='/index.html'||p==='/favicon.svg'))return serve(res,p==='/favicon.svg'?'favicon.svg':'index.html');
  if(req.method==='GET'&&p.startsWith('/images/')){const name=path.basename(p.slice('/images/'.length));if(name===p.slice('/images/'.length)&&/^[a-z0-9-]+\.jpg$/i.test(name))return serve(res,`images/${name}`)}
  if(req.method==='GET'&&['/styles.css','/app.js','/staff.js','/manage.js','/my-bookings.js'].includes(p))return serve(res,p.slice(1));
  return json(res,404,{error:'Not found.'});
}
function serve(res,file){const f=path.join(ROOT,'public',file);fs.readFile(f,(err,data)=>{if(err){res.writeHead(404);return res.end('Not found')}res.writeHead(200,{'content-type':mime[path.extname(file)]||'text/html; charset=utf-8','cache-control':'no-store'});res.end(data)})}
http.createServer((req,res)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'");main(req,res).catch(e=>{console.error(e);if(!res.headersSent){const code=e.statusCode||(e.code==='BOOKING_CONFLICT'||e.code==='BOOKING_VERSION_CONFLICT'||String(e.code||'').startsWith('SQLITE_CONSTRAINT_UNIQUE')?409:500);json(res,code,{error:code===500?'Something went wrong. Please try again.':e.message})}})}).listen(PORT,HOST,()=>console.log(`Waggly is ready at http://localhost:${PORT}`));
