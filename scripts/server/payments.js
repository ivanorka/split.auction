let stripeClient;

function configuredSecretKey(){
  const key = String(process.env.STRIPE_SECRET_KEY || '').trim();
  return key.startsWith('sk_') ? key : '';
}

function paymentConfiguration(){
  const key = configuredSecretKey();
  return {
    provider:'stripe',
    enabled:Boolean(key),
    mode:key.startsWith('sk_test_') ? 'test' : (key ? 'live' : 'unconfigured')
  };
}

function stripe(){
  const key = configuredSecretKey();
  if(!key) return null;
  if(!stripeClient) stripeClient = require('stripe')(key);
  return stripeClient;
}

function applicationUrl(req){
  const configured = String(process.env.APP_URL || '').trim().replace(/\/$/, '');
  if(/^https?:\/\//.test(configured)) return configured;
  const protocol = String(req.headers['x-forwarded-proto'] || '').split(',')[0] || 'http';
  const host = String(req.headers.host || 'localhost:5173');
  return `${protocol}://${host}`;
}

async function createCheckoutSession({ req, reservation, hotel, auctionPackage, customer }){
  const client = stripe();
  if(!client){
    const error = new Error('Stripe sandbox još nije konfiguriran. Dodajte STRIPE_SECRET_KEY za aktivaciju plaćanja.');
    error.code = 'STRIPE_NOT_CONFIGURED';
    throw error;
  }
  const appUrl = applicationUrl(req);
  const amount = Math.round(Number(reservation.amount) * 100);
  const session = await client.checkout.sessions.create({
    mode:'payment',
    customer_email:customer.email,
    client_reference_id:reservation.id,
    metadata:{
      reservationId:reservation.id,
      bookingCode:reservation.bookingCode,
      hotelId:hotel.id,
      packageId:auctionPackage.id
    },
    line_items:[{
      quantity:1,
      price_data:{
        currency:'eur',
        unit_amount:amount,
        product_data:{
          name:`${hotel.name} - ${auctionPackage.name}`,
          description:`Rezervacija ${reservation.bookingCode} | ${reservation.dates}`
        }
      }
    }],
    success_url:`${appUrl}/account.html?payment=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:`${appUrl}/account.html?payment=cancelled`
  });
  return { id:session.id, url:session.url, mode:paymentConfiguration().mode };
}

module.exports = { createCheckoutSession, paymentConfiguration };
