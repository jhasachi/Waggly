const assert = require('node:assert/strict');
const {spawn, spawnSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const {after, before, test} = require('node:test');
const {randomUUID} = require('node:crypto');

const root = path.resolve(__dirname, '..');
let dataDir;
let child;
let port;
let base;
let staffCookie;

function freePort() {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      const value = listener.address().port;
      listener.close(error => error ? reject(error) : resolve(value));
    });
  });
}

async function startServer() {
  port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [path.join(root, 'server.js')], {
    cwd:root,
    env:{...process.env,PORT:String(port),HOST:'127.0.0.1',WAGGLY_DATA_DIR:dataDir,STAFF_PASSWORD:'test-staff-password'},
    stdio:['ignore','pipe','pipe']
  });
  let output = '';
  child.stdout.on('data',chunk=>{output+=chunk.toString()});
  child.stderr.on('data',chunk=>{output+=chunk.toString()});
  const deadline = Date.now()+8000;
  while(Date.now()<deadline){
    if(child.exitCode!==null)throw new Error(`Test server exited early: ${output}`);
    try{const response=await fetch(`${base}/api/services`);if(response.ok)return}
    catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  child.kill('SIGTERM');
  throw new Error(`Test server did not start: ${output}`);
}

async function stopServer(){
  if(!child||child.exitCode!==null)return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise(resolve=>child.once('exit',resolve)),
    new Promise(resolve=>setTimeout(resolve,3000))
  ]);
  if(child.exitCode===null)child.kill('SIGKILL');
}

async function jsonRequest(url, options={}){
  const response=await fetch(url,{...options,headers:{'content-type':'application/json',...(options.headers||{})}});
  const data=await response.json();
  return {response,data};
}

async function futureOpenDay(){
  const today=new Date();
  for(let offset=2;offset<16;offset++){
    const date=new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),today.getUTCDate()+offset));
    if(date.getUTCDay()===0)continue;
    const value=date.toISOString().slice(0,10);
    const response=await fetch(`${base}/api/slots?date=${value}&serviceIds=full-groom`);
    const slots=await response.json();
    if(slots.length>=2)return {date:value,slots};
  }
  throw new Error('Could not find a future test day with two open slots.');
}

before(async()=>{
  dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'waggly-milestone-7-'));
  await startServer();
});

after(async()=>{
  await stopServer();
  fs.rmSync(dataDir,{recursive:true,force:true});
});

test('booking, availability, staff workflow, browser pages, and persistence',async()=>{
  const productionGuard=spawnSync(process.execPath,[path.join(root,'server.js')],{cwd:root,env:{...process.env,NODE_ENV:'production',STAFF_PASSWORD:'',PORT:'0',WAGGLY_DATA_DIR:dataDir},encoding:'utf8'});
  assert.notEqual(productionGuard.status,0);
  assert.match(productionGuard.stderr,/Set a unique STAFF_PASSWORD/);

  const headers=await fetch(`${base}/api/services`);
  assert.equal(headers.status,200);
  assert.equal(headers.headers.get('cache-control'),'no-store');
  assert.equal(headers.headers.get('x-content-type-options'),'nosniff');
  assert.equal(headers.headers.get('x-frame-options'),'DENY');
  assert.equal(headers.headers.get('referrer-policy'),'no-referrer');
  const services=await headers.json();
  assert.ok(services.some(service=>service.id==='full-groom'));

  assert.equal((await fetch(`${base}/my-bookings`)).status,200);
  assert.equal((await fetch(`${base}/my-bookings.js`)).status,200);
  assert.equal((await fetch(`${base}/api/staff/bookings`)).status,401);
  const malformed=await fetch(`${base}/api/bookings`,{method:'POST',headers:{'content-type':'application/json'},body:'null'});
  assert.equal(malformed.status,400);
  const oversized=await fetch(`${base}/api/bookings`,{method:'POST',headers:{'content-type':'application/json'},body:'x'.repeat(100_001)});
  assert.equal(oversized.status,413);

  const {date,slots}=await futureOpenDay();
  const requestKey=randomUUID();
  const payload={serviceIds:['full-groom'],petName:'Test Pup',petSize:'Medium',name:'Test Customer',phone:'',date,time:slots[0],requestKey};
  const first=await jsonRequest(`${base}/api/bookings`,{method:'POST',body:JSON.stringify(payload)});
  assert.equal(first.response.status,201);
  assert.match(first.data.token,/^[a-f0-9]{64}$/);
  assert.match(first.data.reference,/^WG-\d{4}-[A-F0-9]{6}$/);

  const duplicate=await jsonRequest(`${base}/api/bookings`,{method:'POST',body:JSON.stringify(payload)});
  assert.equal(duplicate.response.status,200);
  assert.equal(duplicate.data.token,first.data.token);
  assert.equal(duplicate.data.reference,first.data.reference);

  const conflict=await jsonRequest(`${base}/api/bookings`,{method:'POST',body:JSON.stringify({...payload,requestKey:randomUUID()})});
  assert.equal(conflict.response.status,409);

  const appointment=await jsonRequest(`${base}/api/manage/${first.data.token}`);
  assert.equal(appointment.response.status,200);
  assert.equal(appointment.data.status,'PENDING');
  assert.equal(Object.hasOwn(appointment.data,'token'),false);
  assert.equal(Object.hasOwn(appointment.data,'email'),false);

  const shorterSlots=await fetch(`${base}/api/slots?date=${date}&serviceIds=nail-trim`).then(response=>response.json());
  const fullGroomStart=Number(slots[0].slice(0,2))*60+Number(slots[0].slice(3));
  for(let offset=0;offset<120;offset+=30){
    const time=`${String(Math.floor((fullGroomStart+offset)/60)).padStart(2,'0')}:${String((fullGroomStart+offset)%60).padStart(2,'0')}`;
    assert.equal(shorterSlots.includes(time),false,`${time} should be reserved by the two-hour service`);
  }

  const rejectedPayload={...payload,time:slots.at(-1),requestKey:randomUUID(),petName:'Declined Pup'};
  const rejectedRequest=await jsonRequest(`${base}/api/bookings`,{method:'POST',body:JSON.stringify(rejectedPayload)});
  assert.equal(rejectedRequest.response.status,201);

  const login=await jsonRequest(`${base}/api/staff/login`,{method:'POST',body:JSON.stringify({password:'test-staff-password'})});
  assert.equal(login.response.status,200);
  staffCookie=login.response.headers.get('set-cookie').split(';')[0];
  const staffList=await jsonRequest(`${base}/api/staff/bookings`,{headers:{cookie:staffCookie}});
  assert.equal(staffList.response.status,200);
  const booking=staffList.data.find(item=>item.reference===first.data.reference);
  assert.ok(booking);
  assert.equal(Object.hasOwn(booking,'email'),false);

  const accepted=await jsonRequest(`${base}/api/staff/action`,{method:'POST',headers:{cookie:staffCookie},body:JSON.stringify({id:booking.id,action:'accept'})});
  assert.equal(accepted.response.status,200);
  assert.equal(accepted.data.status,'CONFIRMED');
  const started=await jsonRequest(`${base}/api/staff/action`,{method:'POST',headers:{cookie:staffCookie},body:JSON.stringify({id:booking.id,action:'start'})});
  assert.equal(started.data.status,'IN_PROGRESS');
  const completed=await jsonRequest(`${base}/api/staff/action`,{method:'POST',headers:{cookie:staffCookie},body:JSON.stringify({id:booking.id,action:'complete'})});
  assert.equal(completed.data.status,'COMPLETED');

  const rejectedBooking=staffList.data.find(item=>item.reference===rejectedRequest.data.reference);
  const declined=await jsonRequest(`${base}/api/staff/action`,{method:'POST',headers:{cookie:staffCookie},body:JSON.stringify({id:rejectedBooking.id,action:'reject',reason:'Schedule change'})});
  assert.equal(declined.data.status,'REJECTED');
  const declinedDetails=await jsonRequest(`${base}/api/manage/${rejectedRequest.data.token}`);
  assert.equal(declinedDetails.data.reason,'Schedule change');
  const customerAction=await jsonRequest(`${base}/api/manage/${first.data.token}`,{method:'POST',body:JSON.stringify({action:'cancel'})});
  assert.equal(customerAction.response.status,404);

  await stopServer();
  await startServer();
  const persisted=await jsonRequest(`${base}/api/manage/${first.data.token}`);
  assert.equal(persisted.response.status,200);
  assert.equal(persisted.data.status,'COMPLETED');
});
