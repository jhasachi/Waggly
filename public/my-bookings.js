const SAVED_BOOKINGS_KEY='waggly.savedBookings';
const list=document.querySelector('#saved-list');
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

async function getBooking(token){
  const response=await fetch('/api/manage/'+encodeURIComponent(token),{cache:'no-store'});
  const data=await response.json();
  if(!response.ok)throw Error(data.error||'Could not load this appointment.');
  return data;
}

async function load(){
  let saved=[];
  try{saved=JSON.parse(localStorage.getItem(SAVED_BOOKINGS_KEY)||'[]')}
  catch{saved=[]}
  saved=Array.isArray(saved)?saved.filter(item=>item&&/^[a-f0-9]{64}$/.test(item.token)):[];
  if(!saved.length){
    list.innerHTML='<div class="saved-empty"><div class="success-icon">🐾</div><h2>No bookings saved here yet</h2><p>After you book, your appointment will show up on this browser.</p><a class="button green" href="/#book">Book an appointment</a></div>';
    return;
  }

  const results=await Promise.all(saved.map(async item=>{
    try{return {item,booking:await getBooking(item.token)}}
    catch(error){return {item,error}}
  }));
  list.innerHTML=results.map(({item,booking,error})=>{
    if(error)return `<article class="saved-card"><span class="saved-ref">${esc(item.reference||'WAGGLY BOOKING')}</span><p class="saved-meta">${esc(error.message)}</p></article>`;
    return `<article class="saved-card">
      <div class="saved-card-head"><span class="saved-ref">${esc(booking.reference)}</span><span class="saved-status ${esc(booking.status)}">${esc(booking.status.replaceAll('_',' '))}</span></div>
      <h2>${esc(booking.petName)} · ${esc(booking.service)}</h2>
      <div class="saved-meta">${esc(booking.date)} at ${esc(booking.time)} Prague time<br>${booking.price} CZK · booked by ${esc(booking.name)}</div>
      ${booking.reason?`<p class="saved-meta">Team note: ${esc(booking.reason)}</p>`:''}
      <div class="saved-actions"><a class="text-link" href="/manage/${encodeURIComponent(item.token)}">Review appointment</a></div>
    </article>`;
  }).join('');
  const refresh=document.createElement('button');
  refresh.className='button peach';
  refresh.textContent='Refresh status';
  refresh.onclick=load;
  list.prepend(refresh);
}

load();
