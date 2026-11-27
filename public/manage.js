const app=document.querySelector('#manage-app');
const token=location.pathname.split('/').filter(Boolean).pop();
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

async function api(url,opt={}){
  const response=await fetch(url,{...opt,headers:{'content-type':'application/json'}});
  const data=await response.json();
  if(!response.ok)throw Error(data.error||'Please try again.');
  return data;
}

async function load(){
  try{
    const booking=await api('/api/manage/'+encodeURIComponent(token));
    app.innerHTML=`<span class="eyebrow">YOUR WAGGLY APPOINTMENT</span>
      <h1>Hi ${esc(booking.name.split(' ')[0])}!</h1>
      <p class="manage-subtle">Booking reference <b>${esc(booking.reference)}</b></p>
      <p><span class="manage-label">${esc(booking.status.replaceAll('_',' '))}</span></p>
      <div class="summary">
        <div class="summary-line"><span>Service</span><strong>${esc(booking.service)} · ${booking.price} CZK</strong></div>
        <div class="summary-line"><span>Your pup</span><strong>${esc(booking.petName)} · ${esc(booking.petSize)}</strong></div>
        <div class="summary-line"><span>Appointment</span><strong>${esc(booking.date)} · ${esc(booking.time)} Prague time</strong></div>
        ${booking.reason?`<div class="summary-line"><span>Team note</span><strong>${esc(booking.reason)}</strong></div>`:''}
      </div>
      <p class="manage-subtle"><a href="/my-bookings">Back to My bookings</a></p>`;
  }catch(error){
    app.innerHTML=`<span class="eyebrow">WAGGLY APPOINTMENT LINK</span><h1>Hmm, that link didn’t work.</h1><p>${esc(error.message)} Please check the address or return to My bookings.</p><a href="/my-bookings" class="button green">My bookings</a>`;
  }
}

load();
