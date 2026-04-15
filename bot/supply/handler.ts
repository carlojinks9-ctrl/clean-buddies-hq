import type { SupabaseClient } from '@supabase/supabase-js'

export async function handleSupplyCommand(
  db: SupabaseClient,
  args: string,
  requestedBy: string,
  messageId: string
): Promise<string> {
  // Parse: [item] [qty] [job name] OR just [item]
  const parts = args.match(/^(.+?)\s+(\d+)\s+(.+)$/)
  let itemName: string
  let quantity = 1
  let jobName = ''

  if (parts) {
    itemName = parts[1].trim()
    quantity = parseInt(parts[2])
    jobName = parts[3].trim()
  } else {
    const simple = args.match(/^(.+?)\s+(\d+)$/)
    if (simple) {
      itemName = simple[1].trim()
      quantity = parseInt(simple[2])
    } else {
      itemName = args.trim()
    }
  }

  if (!itemName) {
    return '❌ Usage: /supply [item name] [quantity] [job name]'
  }

  try {
    await db.from('supply_requests').insert({
      item_name: itemName,
      quantity,
      job_name: jobName || null,
      requested_by: requestedBy,
      priority: 'medium',
      status: 'pending',
      telegram_message_id: messageId,
      home_depot_url: `https://www.homedepot.com/s/${encodeURIComponent(itemName)}`,
    })

    return (
      `✅ <b>Supply request logged</b>\n\n` +
      `Item: ${itemName}\n` +
      `Qty: ${quantity}\n` +
      (jobName ? `Job: ${jobName}\n` : '') +
      `\n<a href="${process.env.NEXT_PUBLIC_APP_URL || 'https://clean-buddies-hq.vercel.app'}/supplies">View supply list →</a>`
    )
  } catch (err) {
    console.error('Supply handler error:', err)
    return '❌ Failed to log supply request. Please try again.'
  }
}
