/**
 * Northbridge Home Ops — Vercel serverless Control Plane.
 * Faithful port of the Python MCP REST surface for the public demo.
 * Household: Avery & Morgan Quinn (Northbridge only).
 */
import crypto from 'crypto'

const VERSION = '0.1.0'
const DEMO_TODAY = '2026-09-15'
const GENESIS = '0'.repeat(64)

const HOUSEHOLD = {
  household_id: 'northbridge-quinn',
  name: 'Northbridge',
  members: [
    { id: 'avery', name: 'Avery Quinn', role: 'ops_primary', alexa_profile: 'Avery' },
    { id: 'morgan', name: 'Morgan Quinn', role: 'ops_secondary', alexa_profile: 'Morgan' },
  ],
  timezone: 'America/Los_Angeles',
  address_label: 'Northbridge residence',
  preferences: {
    escalate_only: true,
    quiet_hours: { start: '21:00', end: '07:00' },
    auto_handle_categories: ['utilities', 'insurance', 'rent', 'internet'],
    human_required_categories: ['medical', 'tax', 'legal', 'unknown'],
  },
}

const POLICY = {
  version: '2026.09',
  mode: 'escalate_only',
  rules: [
    { id: 'amount_out_of_band', when: 'amount outside expected_amount_range', decision: 'HUMAN_REQUIRED', reason: 'Unexpected amount — confirm before funding' },
    { id: 'duplicate_charge', when: 'same payee + amount + due_date as another open bill', decision: 'HUMAN_REQUIRED', reason: 'Possible duplicate charge' },
    { id: 'category_sensitive', when: 'category in medical|tax|legal|unknown', decision: 'HUMAN_REQUIRED', reason: 'Sensitive category always escalates' },
    { id: 'insufficient_funding', when: 'available_balance - reserve_floor < amount', decision: 'HUMAN_REQUIRED', reason: 'Funding shortfall vs reserve floor' },
    { id: 'routine_in_band', when: 'no anomalies and category auto-eligible', decision: 'AUTO', reason: 'Routine bill within expected band with adequate funding' },
  ],
  auto_eligible_categories: ['utilities', 'insurance', 'rent', 'internet', 'subscription'],
}

const BILLS = [
  { id: 'bill-pge-2026-09', payee: 'Pacific Gas & Electric', category: 'utilities', amount: 142.55, currency: 'USD', due_date: '2026-09-18', status: 'due', autopay: true, account_last4: '4412', expected_amount_range: [110.0, 165.0], funding_account_id: 'fund-checking', notes: 'Routine summer usage within band' },
  { id: 'bill-streamflix-2026-09', payee: 'StreamFlix Premium', category: 'subscription', amount: 29.99, currency: 'USD', due_date: '2026-09-16', status: 'due', autopay: true, account_last4: '8821', expected_amount_range: [15.99, 17.99], funding_account_id: 'fund-checking', notes: 'Unexpected plan bump — was $15.99' },
  { id: 'bill-rent-2026-09', payee: 'Northbridge Property Mgmt', category: 'rent', amount: 2850.0, currency: 'USD', due_date: '2026-10-01', status: 'due', autopay: false, account_last4: '1001', expected_amount_range: [2850.0, 2850.0], funding_account_id: 'fund-checking', notes: 'Monthly rent — exact match' },
  { id: 'bill-pge-dup-2026-09', payee: 'Pacific Gas & Electric', category: 'utilities', amount: 142.55, currency: 'USD', due_date: '2026-09-18', status: 'due', autopay: false, account_last4: '4412', expected_amount_range: [110.0, 165.0], funding_account_id: 'fund-checking', notes: 'Suspected duplicate of bill-pge-2026-09' },
  { id: 'bill-dental-2026-09', payee: 'Bayview Family Dental', category: 'medical', amount: 420.0, currency: 'USD', due_date: '2026-09-22', status: 'due', autopay: false, account_last4: '7730', expected_amount_range: [80.0, 150.0], funding_account_id: 'fund-hsa', notes: 'Crown work — confirm insurance remittance first' },
  { id: 'bill-fiber-2026-09', payee: 'Cascadia Fiber', category: 'internet', amount: 79.0, currency: 'USD', due_date: '2026-09-20', status: 'due', autopay: true, account_last4: '3309', expected_amount_range: [79.0, 79.0], funding_account_id: 'fund-checking', notes: 'Flat rate gigabit' },
]

const FUNDING = [
  { id: 'fund-checking', name: 'Northbridge Joint Checking', institution: 'Cascadia Credit Union', type: 'checking', available_balance: 4120.35, currency: 'USD', reserve_floor: 800.0, last4: '1001' },
  { id: 'fund-hsa', name: 'Avery HSA', institution: 'HealthLedger', type: 'hsa', available_balance: 890.0, currency: 'USD', reserve_floor: 200.0, last4: '7730' },
  { id: 'fund-savings', name: 'Emergency Savings', institution: 'Cascadia Credit Union', type: 'savings', available_balance: 12500.0, currency: 'USD', reserve_floor: 5000.0, last4: '5522' },
]

const CALENDAR = [
  { id: 'due-bill-pge', title: 'PG&E due', kind: 'bill', ref_id: 'bill-pge-2026-09', due_date: '2026-09-18', priority: 'normal' },
  { id: 'due-bill-streamflix', title: 'StreamFlix renewal', kind: 'bill', ref_id: 'bill-streamflix-2026-09', due_date: '2026-09-16', priority: 'high' },
  { id: 'due-bill-rent', title: 'Rent — Northbridge Property Mgmt', kind: 'bill', ref_id: 'bill-rent-2026-09', due_date: '2026-10-01', priority: 'high' },
  { id: 'due-bill-pge-dup', title: 'PG&E (possible duplicate)', kind: 'bill', ref_id: 'bill-pge-dup-2026-09', due_date: '2026-09-18', priority: 'high' },
  { id: 'due-bill-dental', title: 'Bayview Dental balance', kind: 'bill', ref_id: 'bill-dental-2026-09', due_date: '2026-09-22', priority: 'high' },
  { id: 'due-bill-fiber', title: 'Cascadia Fiber', kind: 'bill', ref_id: 'bill-fiber-2026-09', due_date: '2026-09-20', priority: 'normal' },
  { id: 'due-hoa-packet', title: 'HOA annual packet review', kind: 'admin', ref_id: null, due_date: '2026-09-25', priority: 'normal', notes: 'Read-only calendar item — no payment' },
  { id: 'due-insurance-renewal', title: 'Renters insurance renewal window', kind: 'reminder', ref_id: null, due_date: '2026-09-28', priority: 'low' },
]

const TOOL_CATALOG = [
  { name: 'list_upcoming_dues', description: 'List upcoming household dues from the calendar (bills, admin, reminders).' },
  { name: 'parse_bill_status', description: 'Parse a bill into a normalized status summary for Alexa+ / agent reasoning.' },
  { name: 'check_funding', description: 'Check whether the mapped funding account can cover the bill above its reserve floor.' },
  { name: 'detect_anomaly', description: 'Detect anomalies: amount outside expected range, or duplicate payee/amount/due_date.' },
  { name: 'prepare_decision_brief', description: 'Prepare a concise decision brief for Avery/Morgan when human judgment is required.' },
  { name: 'mark_auto_handled', description: 'Mark a routine bill as quietly auto-handled — no human ping.' },
  { name: 'notify_human', description: 'Escalate to Avery/Morgan only when a real decision is required (Alexa+ speakable ping).' },
]

const TOOL_NAMES = TOOL_CATALOG.map((t) => t.name)

function emptyState() {
  return { handled: [], needs_decision: [], briefs: [], notifications: [], auto_summaries: [] }
}

// In-memory demo state (warm instance). Reset recreates fresh fixtures.
const g = globalThis
if (!g.__northbridge) {
  g.__northbridge = { state: emptyState(), ledger: [] }
}

// Stable JSON for hashing (sort_keys like Python)
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']'
  const keys = Object.keys(value).sort()
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}'
}

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex')
}

function appendLedger(tool, arguments_, result, decision = null) {
  const prev = g.__northbridge.ledger.length
    ? g.__northbridge.ledger[g.__northbridge.ledger.length - 1].entry_hash
    : GENESIS
  const body = {
    ts: new Date().toISOString(),
    tool,
    arguments: arguments_,
    result_digest: sha256(stableStringify({ result })).slice(0, 16),
    decision,
    prev_hash: prev,
  }
  const entry_hash = sha256(prev + stableStringify(body))
  const entry = { ...body, entry_hash }
  g.__northbridge.ledger.push(entry)
  return entry
}

function verifyLedger() {
  const rows = g.__northbridge.ledger
  if (!rows.length) return { ok: true, entries: 0, message: 'empty ledger' }
  let prev = GENESIS
  for (let i = 0; i < rows.length; i++) {
    const entry = rows[i]
    const body = { ...entry }
    delete body.entry_hash
    const expected = sha256(prev + stableStringify(body))
    if (entry.prev_hash !== prev) return { ok: false, entries: i, error: `prev_hash mismatch at line ${i + 1}` }
    if (entry.entry_hash !== expected) return { ok: false, entries: i, error: `entry_hash mismatch at line ${i + 1}` }
    prev = entry.entry_hash
  }
  return { ok: true, entries: rows.length, tip_hash: prev }
}

function billById(id) {
  return BILLS.find((b) => b.id === id) || null
}

function fundingById(id) {
  return FUNDING.find((a) => a.id === id) || null
}

function evaluateDecision(bill, anomalies, funding) {
  const reasons = []
  const rule_ids = []
  const category = (bill.category || 'unknown').toLowerCase()
  const sensitive = new Set(['medical', 'tax', 'legal', 'unknown'])
  if (sensitive.has(category)) {
    reasons.push(`Sensitive category '${category}' always escalates`)
    rule_ids.push('category_sensitive')
  }
  for (const a of anomalies) {
    if (a.startsWith('amount_unexpected')) {
      reasons.push(a)
      rule_ids.push('amount_out_of_band')
    } else if (a.startsWith('duplicate_charge')) {
      reasons.push(a)
      rule_ids.push('duplicate_charge')
    } else {
      reasons.push(a)
      rule_ids.push('other_anomaly')
    }
  }
  if (funding && !funding.sufficient) {
    reasons.push(funding.reason || 'Insufficient funding vs reserve floor')
    rule_ids.push('insufficient_funding')
  }
  const autoCats = new Set(POLICY.auto_eligible_categories)
  if (!reasons.length && !autoCats.has(category)) {
    reasons.push(`Category '${category}' is not auto-eligible`)
    rule_ids.push('category_not_auto')
  }
  if (reasons.length) {
    return { decision: 'HUMAN_REQUIRED', reasons, rule_ids: [...new Set(rule_ids)].sort(), policy_version: POLICY.version }
  }
  return {
    decision: 'AUTO',
    reasons: ['Routine bill within expected band with adequate funding'],
    rule_ids: ['routine_in_band'],
    policy_version: POLICY.version,
  }
}

function listUpcomingDues(within_days = 30, kind = 'all') {
  const today = new Date(DEMO_TODAY + 'T00:00:00Z')
  const handled = new Set(g.__northbridge.state.handled)
  const items = []
  for (const row of CALENDAR) {
    const due = new Date(row.due_date + 'T00:00:00Z')
    const delta = Math.round((due - today) / 86400000)
    if (delta < 0 || delta > within_days) continue
    if (kind !== 'all' && row.kind !== kind) continue
    const ref = row.ref_id
    items.push({ ...row, days_until_due: delta, already_handled: !!(ref && handled.has(ref)) })
  }
  items.sort((a, b) => (a.due_date === b.due_date ? (a.priority === 'high' ? -1 : 1) : a.due_date.localeCompare(b.due_date)))
  const payload = { as_of: DEMO_TODAY, household: HOUSEHOLD.name, count: items.length, dues: items }
  appendLedger('list_upcoming_dues', { within_days, kind }, payload)
  return payload
}

function parseBillStatus(bill_id) {
  const bill = billById(bill_id)
  if (!bill) {
    const err = { error: `Unknown bill_id ${bill_id}` }
    appendLedger('parse_bill_status', { bill_id }, err)
    return err
  }
  const [low, high] = bill.expected_amount_range || [bill.amount, bill.amount]
  const state = g.__northbridge.state
  const summary = {
    id: bill.id,
    payee: bill.payee,
    amount: bill.amount,
    currency: bill.currency || 'USD',
    due_date: bill.due_date,
    category: bill.category,
    status: bill.status || 'due',
    autopay: !!bill.autopay,
    expected_low: low,
    expected_high: high,
    in_expected_band: bill.amount >= low && bill.amount <= high,
    funding_account_id: bill.funding_account_id,
    account_last4: bill.account_last4,
    notes: bill.notes || '',
    handled: state.handled.includes(bill_id),
    needs_decision: state.needs_decision.includes(bill_id),
  }
  appendLedger('parse_bill_status', { bill_id }, summary)
  return summary
}

function checkFunding(bill_id) {
  const bill = billById(bill_id)
  if (!bill) {
    const err = { error: `Unknown bill_id ${bill_id}` }
    appendLedger('check_funding', { bill_id }, err)
    return err
  }
  const account = fundingById(bill.funding_account_id)
  if (!account) {
    const err = { bill_id, sufficient: false, reason: 'No funding account mapped' }
    appendLedger('check_funding', { bill_id }, err, 'HUMAN_REQUIRED')
    return err
  }
  const available = Number(account.available_balance)
  const floor = Number(account.reserve_floor || 0)
  const amount = Number(bill.amount)
  const spendable = available - floor
  const sufficient = spendable >= amount
  const payload = {
    bill_id,
    payee: bill.payee,
    amount,
    account_id: account.id,
    account_name: account.name,
    available_balance: available,
    reserve_floor: floor,
    spendable_above_floor: Math.round(spendable * 100) / 100,
    sufficient,
    reason: sufficient ? null : `Need $${amount.toFixed(2)} but only $${spendable.toFixed(2)} above reserve floor $${floor.toFixed(2)}`,
  }
  appendLedger('check_funding', { bill_id }, payload, sufficient ? 'AUTO' : 'HUMAN_REQUIRED')
  return payload
}

function detectAnomaly(bill_id) {
  const bill = billById(bill_id)
  if (!bill) {
    const err = { error: `Unknown bill_id ${bill_id}` }
    appendLedger('detect_anomaly', { bill_id }, err)
    return err
  }
  const anomalies = []
  const [low, high] = bill.expected_amount_range || [bill.amount, bill.amount]
  if (bill.amount < low || bill.amount > high) {
    anomalies.push(`amount_unexpected: ${bill.amount} outside expected [${low}, ${high}]`)
  }
  const duplicates = BILLS.filter(
    (other) =>
      other.id !== bill_id &&
      other.payee === bill.payee &&
      other.amount === bill.amount &&
      other.due_date === bill.due_date &&
      other.status === 'due' &&
      other.id < bill_id
  ).map((o) => o.id)
  if (duplicates.length) anomalies.push(`duplicate_charge: mirrors ${duplicates.join(', ')}`)
  const funding = checkFunding(bill_id)
  const decision_info = evaluateDecision(bill, anomalies, funding)
  const payload = {
    bill_id,
    payee: bill.payee,
    anomalies,
    funding_sufficient: funding.sufficient,
    decision: decision_info.decision,
    reasons: decision_info.reasons,
    rule_ids: decision_info.rule_ids,
    needs_human_decision: decision_info.decision === 'HUMAN_REQUIRED',
    safe_to_auto_handle: decision_info.decision === 'AUTO',
  }
  appendLedger('detect_anomaly', { bill_id }, payload, decision_info.decision)
  return payload
}

function prepareDecisionBrief(bill_id) {
  const bill = billById(bill_id)
  if (!bill) {
    const err = { error: `Unknown bill_id ${bill_id}` }
    appendLedger('prepare_decision_brief', { bill_id }, err)
    return err
  }
  const anomaly = detectAnomaly(bill_id)
  const funding = checkFunding(bill_id)
  const status = parseBillStatus(bill_id)
  let recommended = 'Approve payment as-is'
  if ((anomaly.anomalies || []).some((a) => a.includes('duplicate'))) {
    recommended = 'Dismiss duplicate — keep the original PG&E bill only'
  } else if ((anomaly.anomalies || []).some((a) => a.includes('amount_unexpected'))) {
    recommended = 'Confirm new amount with payee / cancel unexpected plan change'
  } else if (bill.category === 'medical') {
    recommended = 'Confirm insurance remittance, then approve remainder from HSA'
  } else if (!funding.sufficient) {
    recommended = 'Move funds above reserve floor, then re-run check_funding'
  }
  const brief = {
    bill_id,
    headline: `${bill.payee} — $${Number(bill.amount).toFixed(2)} due ${bill.due_date}`,
    decision: anomaly.decision,
    why: anomaly.reasons || [],
    status,
    funding: {
      account: funding.account_name,
      sufficient: funding.sufficient,
      spendable_above_floor: funding.spendable_above_floor,
    },
    recommended_action: recommended,
    alexa_speak:
      'I need a decision on ' +
      bill.payee +
      '. ' +
      (anomaly.reasons || []).join('; ') +
      '. I recommend: ' +
      recommended +
      '.',
  }
  g.__northbridge.state.briefs.push(brief)
  appendLedger('prepare_decision_brief', { bill_id }, brief, brief.decision)
  return brief
}

function markAutoHandled(bill_id, summary = '') {
  const bill = billById(bill_id)
  if (!bill) {
    const err = { error: `Unknown bill_id ${bill_id}` }
    appendLedger('mark_auto_handled', { bill_id, summary }, err)
    return err
  }
  const anomaly = detectAnomaly(bill_id)
  if (anomaly.decision !== 'AUTO') {
    const err = {
      handled: false,
      bill_id,
      error: 'Policy is HUMAN_REQUIRED — use notify_human / prepare_decision_brief',
      decision: anomaly.decision,
      reasons: anomaly.reasons,
    }
    appendLedger('mark_auto_handled', { bill_id, summary }, err, 'HUMAN_REQUIRED')
    return err
  }
  const finalSummary = summary || `Auto-prepared ${bill.payee} ($${bill.amount}) due ${bill.due_date}`
  if (!g.__northbridge.state.handled.includes(bill_id)) g.__northbridge.state.handled.push(bill_id)
  g.__northbridge.state.auto_summaries.push({ bill_id, summary: finalSummary, at: new Date().toISOString() })
  const payload = { handled: true, bill_id, summary: finalSummary, decision: 'AUTO' }
  appendLedger('mark_auto_handled', { bill_id, summary: finalSummary }, payload, 'AUTO')
  return payload
}

function notifyHuman(bill_id, reason, recommended_action) {
  const bill = billById(bill_id)
  if (!bill) {
    const err = { error: `Unknown bill_id ${bill_id}` }
    appendLedger('notify_human', { bill_id, reason, recommended_action }, err)
    return err
  }
  const note = {
    bill_id,
    payee: bill.payee,
    amount: bill.amount,
    reason,
    recommended_action,
    channel: 'alexa_plus_decision_gate',
    speakable: `Northbridge needs you on ${bill.payee}. ${reason}. Suggested next step: ${recommended_action}.`,
  }
  g.__northbridge.state.notifications.push(note)
  if (!g.__northbridge.state.needs_decision.includes(bill_id)) g.__northbridge.state.needs_decision.push(bill_id)
  const payload = { notified: true, notification: note, decision: 'HUMAN_REQUIRED' }
  appendLedger('notify_human', { bill_id, reason, recommended_action }, payload, 'HUMAN_REQUIRED')
  return payload
}

function resetAll() {
  g.__northbridge.state = emptyState()
  g.__northbridge.ledger = []
  return { reset: true }
}

function runOfflinePipeline() {
  resetAll()
  const duesPayload = listUpcomingDues(45, 'bill')
  const results = []
  for (const due of duesPayload.dues) {
    const bill_id = due.ref_id
    if (!bill_id || due.already_handled) continue
    parseBillStatus(bill_id)
    checkFunding(bill_id)
    const anomaly = detectAnomaly(bill_id)
    if (anomaly.decision === 'AUTO') {
      markAutoHandled(bill_id, `Quietly prepared ${anomaly.payee || bill_id}`)
      results.push({ bill_id, action: 'auto_handled', decision: 'AUTO', detail: anomaly })
    } else {
      const brief = prepareDecisionBrief(bill_id)
      notifyHuman(bill_id, (anomaly.reasons || []).join('; ') || 'needs review', brief.recommended_action || 'Review before paying')
      results.push({
        bill_id,
        action: 'notify_human',
        decision: 'HUMAN_REQUIRED',
        detail: anomaly,
        brief_headline: brief.headline,
      })
    }
  }
  return {
    mode: 'offline_fixture_pipeline',
    household: 'Northbridge',
    bills_processed: results.length,
    auto_handled: results.filter((r) => r.action === 'auto_handled').map((r) => r.bill_id),
    escalated: results.filter((r) => r.action === 'notify_human').map((r) => r.bill_id),
    results,
    state: g.__northbridge.state,
    ledger: verifyLedger(),
    strands_tools: TOOL_NAMES,
  }
}

function callTool(name, args = {}) {
  switch (name) {
    case 'list_upcoming_dues':
      return listUpcomingDues(args.within_days ?? 30, args.kind ?? 'all')
    case 'parse_bill_status':
      return parseBillStatus(args.bill_id)
    case 'check_funding':
      return checkFunding(args.bill_id)
    case 'detect_anomaly':
      return detectAnomaly(args.bill_id)
    case 'prepare_decision_brief':
      return prepareDecisionBrief(args.bill_id)
    case 'mark_auto_handled':
      return markAutoHandled(args.bill_id, args.summary || '')
    case 'notify_human':
      return notifyHuman(args.bill_id, args.reason || '', args.recommended_action || '')
    default:
      return null
  }
}

function handleUtterance(textRaw) {
  const text = (textRaw || '').trim().toLowerCase()
  const steps = []
  const step = (name, arguments_) => {
    const result = callTool(name, arguments_)
    steps.push({ tool: name, arguments: arguments_, result })
    return result
  }
  let speak = 'I checked Northbridge Home Ops.'

  if (['run demo', 'process all', 'handle everything', 'catch me up', 'quiet pass'].some((k) => text.includes(k))) {
    const result = runOfflinePipeline()
    speak = `I finished the quiet pass. ${result.auto_handled.length} bills auto-handled. ${result.escalated.length} need a decision from you.`
    return { utterance: textRaw, speak, pipeline: result, steps: [] }
  }
  if (['what is due', 'upcoming', 'dues', "what's due", 'whats due', 'this week'].some((k) => text.includes(k))) {
    const dues = step('list_upcoming_dues', { within_days: 30, kind: 'all' })
    speak = `You have ${dues.count} upcoming items on the Northbridge calendar.`
  } else if (text.includes('streamflix') || text.includes('subscription')) {
    const bill_id = 'bill-streamflix-2026-09'
    step('parse_bill_status', { bill_id })
    const anomaly = step('detect_anomaly', { bill_id })
    if (anomaly.decision === 'HUMAN_REQUIRED') {
      const brief = step('prepare_decision_brief', { bill_id })
      step('notify_human', { bill_id, reason: (anomaly.reasons || []).join('; '), recommended_action: brief.recommended_action || 'Review' })
      speak = brief.alexa_speak || 'StreamFlix needs a decision.'
    } else {
      step('mark_auto_handled', { bill_id })
      speak = 'StreamFlix looks routine — I handled it quietly.'
    }
  } else if (text.includes('dental') || text.includes('medical')) {
    const bill_id = 'bill-dental-2026-09'
    step('parse_bill_status', { bill_id })
    const anomaly = step('detect_anomaly', { bill_id })
    const brief = step('prepare_decision_brief', { bill_id })
    step('notify_human', { bill_id, reason: (anomaly.reasons || []).join('; '), recommended_action: brief.recommended_action || 'Review' })
    speak = brief.alexa_speak || 'Dental bill needs you.'
  } else if (text.includes('duplicate') || text.includes('pge') || text.includes('pg&e')) {
    const bill_id = 'bill-pge-dup-2026-09'
    const anomaly = step('detect_anomaly', { bill_id })
    const brief = step('prepare_decision_brief', { bill_id })
    step('notify_human', { bill_id, reason: (anomaly.reasons || []).join('; '), recommended_action: brief.recommended_action || 'Review' })
    speak = brief.alexa_speak || 'Possible duplicate PG&E charge.'
  } else if (text.includes('funding') || text.includes('balance') || text.includes('rent')) {
    step('check_funding', { bill_id: 'bill-rent-2026-09' })
    speak = 'I checked funding for rent against the joint checking reserve floor.'
  } else {
    const dues = step('list_upcoming_dues', { within_days: 14, kind: 'bill' })
    speak = `Northbridge has ${dues.count} bill dues in the next two weeks. Ask me to run the quiet pass, or ask about StreamFlix, dental, or PG&E.`
  }
  return { utterance: textRaw, speak, steps }
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function apiPathFromReq(req) {
  // Prefer rewrite query nb_path (supports nested /api/demo/run etc.)
  let nb = req.query?.nb_path
  if (Array.isArray(nb)) nb = nb.filter(Boolean).join('/')
  if (typeof nb === 'string' && nb.length) {
    return '/api/' + nb.replace(/^\/+/, '')
  }
  // Direct hit on /api/control or legacy catch-all slug
  const slug = req.query?.path
  if (Array.isArray(slug) && slug.length) return '/api/' + slug.join('/')
  if (typeof slug === 'string' && slug) return '/api/' + slug
  try {
    const url = new URL(req.url || '/', 'http://localhost')
    const pathname = url.pathname.replace(/\/+$/, '') || '/api'
    if (pathname === '/api/control' || pathname === '/api') return '/api/health'
    if (pathname.startsWith('/api/')) return pathname
    return '/api/health'
  } catch {
    return '/api/health'
  }
}

export default async function handler(req, res) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()

  const apiPath = apiPathFromReq(req)

  try {
    if (apiPath === '/api/health') {
      return res.status(200).json({
        ok: true,
        service: 'northbridge-home-ops',
        version: VERSION,
        mcp_path: '/mcp',
        protocol: 'streamable-http',
        tools: TOOL_NAMES,
        demo: 'vercel-control-plane',
      })
    }
    if (apiPath === '/api/household') {
      return res.status(200).json({ household: HOUSEHOLD, policy: POLICY, funding: FUNDING, bills: BILLS, calendar: CALENDAR })
    }
    if (apiPath === '/api/state') {
      return res.status(200).json({ state: g.__northbridge.state, ledger: verifyLedger() })
    }
    if (apiPath.startsWith('/api/ledger')) {
      const limit = Number(new URL(req.url, 'http://localhost').searchParams.get('limit') || 40)
      const entries = g.__northbridge.ledger.slice(-limit)
      return res.status(200).json({ entries, verify: verifyLedger() })
    }
    if (apiPath === '/api/tools' && req.method === 'GET') {
      return res.status(200).json({ tools: TOOL_CATALOG })
    }
    if (apiPath === '/api/tools/call' && req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {}
      const name = body.name
      const arguments_ = body.arguments || {}
      if (!TOOL_NAMES.includes(name)) return res.status(404).json({ error: `Unknown tool ${name}` })
      const result = callTool(name, arguments_)
      return res.status(200).json({ name, arguments: arguments_, result })
    }
    if (apiPath === '/api/demo/run' && req.method === 'POST') {
      return res.status(200).json(runOfflinePipeline())
    }
    if (apiPath === '/api/demo/reset' && req.method === 'POST') {
      return res.status(200).json(resetAll())
    }
    if (apiPath === '/api/utterance' && req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {}
      return res.status(200).json(handleUtterance(body.text || ''))
    }

    return res.status(404).json({ error: 'Not found', path: apiPath })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: String(err?.message || err) })
  }
}
