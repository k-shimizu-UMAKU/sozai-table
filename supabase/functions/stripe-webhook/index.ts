// supabase/functions/stripe-webhook/index.ts
// Stripeからの支払い完了・解約通知を受け取り、DBを更新する

import Stripe from 'https://esm.sh/stripe@14.0.0'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2023-10-16',
})

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

Deno.serve(async (req) => {
  const signature = req.headers.get('stripe-signature')!
  const body = await req.text()

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      Deno.env.get('STRIPE_WEBHOOK_SECRET')!
    )
  } catch (err) {
    return new Response(`Webhook Error: ${err.message}`, { status: 400 })
  }

  const updateSubscription = async (customerId: string, status: string) => {
    const customers = await stripe.customers.list({ id: customerId, limit: 1 })
    const userId = customers.data[0]?.metadata?.supabase_user_id
    if (userId) {
      await supabase
        .from('profiles')
        .update({
          subscription_status: status,
          stripe_customer_id: customerId,
        })
        .eq('id', userId)
    }
  }

  switch (event.type) {
    case 'checkout.session.completed':
    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription
      const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id
      await updateSubscription(customerId, 'active')
      break
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription
      const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id
      await updateSubscription(customerId, 'inactive')
      break
    }
    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice
      const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer!.id
      await updateSubscription(customerId, 'past_due')
      break
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
