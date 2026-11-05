(() => {
  'use strict'

  const CONFIG = window.SAT_CONFIG || {}
  const TABLE = 'sat_november_2026_plans'
  const STORAGE_KEY = 'sat-november-2026-online-v1'
  const ADMIN_SESSION_KEY = 'sat-november-admin-session'
  const REGIONS = {
    'Pacífico': ['Chinandega', 'León', 'Managua', 'Masaya', 'Rivas', 'Carazo', 'Granada'],
    'Norte': ['Jinotega', 'Matagalpa', 'Nueva Segovia', 'Estelí', 'Madriz'],
    'Centro y Sureste': ['Boaco', 'Chontales', 'Río San Juan'],
    'Costa Caribe': ['RACCN', 'RACCS']
  }
  const DELEGATIONS = Object.values(REGIONS).flat()
  const displayDelegationName = delegation => delegation
  const PROVIDERS = ['INTUR CENTRAL', 'INATEC', 'MIFIC', 'MINSA', 'SETEC', 'BOMBEROS', 'POLICÍA', 'Cruz Blanca', 'Delegación Departamental', 'Otra institución']
  const ACTIVITY_TYPES = ['Capacitación', 'Taller', 'Curso', 'Seminario', 'Charla', 'Asistencia técnica', 'Otra']
  const MODALITIES = ['Presencial', 'Virtual', 'Híbrida']
  const DDT_FACILITATORS = ['Tania Rodríguez', 'Raúl Zambrana', 'Silvio Rodriguez', 'Karla Aburto', 'Andrea Guatemala', 'Patricia Hernández', 'Maria Guadalupe Munguia']
  const configured = Boolean(CONFIG.supabaseUrl && CONFIG.publishableKey)
  const $ = id => document.getElementById(id)
  const clone = value => JSON.parse(JSON.stringify(value))
  const makeId = () => crypto.randomUUID ? crypto.randomUUID() : `sat-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const now = () => new Date().toISOString()
  const formatDateTime = value => value ? new Intl.DateTimeFormat('es-NI', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : 'Pendiente'
  const isCancelled = item => String(item?.status || '').toUpperCase() === 'CANCELADA'
  const activeActivities = items => (items || []).filter(item => !item.draft && !isCancelled(item))
  const cancelledActivities = items => (items || []).filter(isCancelled)
  const blankActivity = () => ({ id: makeId(), draft: true, activityType: 'Capacitación', topic: '', date: selectedPlanPeriod + '-02', additionalDates: '', startTime: '08:00', endTime: '12:00', municipality: '', location: '', modality: 'Presencial', trainingProvider: '', ddtFacilitator: '', participatingInstitutions: '', responsible: '', projectedParticipants: 25, observations: '' })
  const blankPlan = delegation => ({ remoteId: '', remoteUpdatedAt: '', editToken: makeId(), region: regionFor(delegation), delegation, registrantName: '', registrantRole: '', registrantEmail: '', registrantPhone: '', status: 'BORRADOR', activities: [], createdAt: now(), updatedAt: now() })

  let store = loadStore()
  const periodMonths = 'Enero Febrero Marzo Abril Mayo Junio Julio Agosto Septiembre Octubre Noviembre Diciembre'.split(' ')
  let adminPeriod = '2026-11'
  let adminRequest = 0
  let delegationSession = null
  let delegationAccount = null
  let selectedPlanPeriod = '2026-11'
  let activeDelegationStep = 1
  let delegationCanEdit = false
  let adminRows = []
  let ddtActivities = []
  let savingPlan = false
  let editingActivityId = null
  let editingSnapshot = null
  let pendingCancel = null

  function periodLabel(period) {
    const [year, month] = String(period || '2026-11').split('-').map(Number)
    if (!year || !month || month < 1 || month > 12) return 'Noviembre 2026'
    return `${periodMonths[month - 1]} ${year}`
  }

  function regionFor(delegation) { return Object.keys(REGIONS).find(region => REGIONS[region].includes(delegation)) || 'Pacífico' }
  function normalizeActivityProvider(activity) {
    if (activity?.trainingProvider === 'INTUR') activity.trainingProvider = 'INTUR CENTRAL'
    if (!activity.status) activity.status = 'PROGRAMADA'
    return activity
  }
  function migrateProviderNames(saved) {
    Object.values(saved.plans || {}).forEach(savedPlan => (savedPlan.activities || []).forEach(normalizeActivityProvider))
    return saved
  }
  function loadStore() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
      if (saved && saved.plans) return migrateProviderNames(saved)
    } catch (_) { /* Se inicia un borrador limpio. */ }
    return { selectedDelegation: 'Chinandega', plans: {} }
  }
  function persistLocal() { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)) }
  function plan() {
    const name = store.selectedDelegation || 'Chinandega'
    const key = selectedPlanPeriod === '2026-11' ? name : name + '|' + selectedPlanPeriod
    if (!store.plans[key]) store.plans[key] = blankPlan(name)
    return store.plans[key]
  }
  function toast(message) {
    const element = $('toast'); element.textContent = message; element.classList.add('show')
    clearTimeout(toast.timer); toast.timer = setTimeout(() => element.classList.remove('show'), 3200)
  }
  function setOptions(select, values, selected) {
    select.replaceChildren(...values.map(value => new Option(value, value)))
    select.value = selected
  }
  function saveLocalAndRender() {
    plan().updatedAt = now(); persistLocal(); renderSummary()
    $('saveMessage').textContent = 'Tus cambios se guardaron en este dispositivo. Podés continuar después desde este mismo equipo.'
  }
  function apiHeaders(token, editToken) {
    const headers = { apikey: CONFIG.publishableKey, Authorization: `Bearer ${token || CONFIG.publishableKey}`, 'Content-Type': 'application/json' }
    if (editToken) headers['x-edit-token'] = editToken
    return headers
  }
  async function api(path, options = {}, token = '', editToken = '') {
    const response = await fetch(`${CONFIG.supabaseUrl}${path}`, { ...options, headers: { ...apiHeaders(token, editToken), ...(options.headers || {}) } })
    const text = await response.text()
    let body = null
    try { body = text ? JSON.parse(text) : null } catch (_) { body = { message: text || `Error ${response.status}` } }
    if (!response.ok) { const error = new Error(body?.message || body?.error_description || `Error ${response.status}`); error.status = response.status; throw error }
    return body
  }
  function activitiesFromRemote(row) { return (row.activities || []).map(item => normalizeActivityProvider(clone(item))) }
  function mergeRemoteActivities(localItems, remoteItems) {
    const localById = new Map((localItems || []).map(item => [item.id, item]))
    const merged = (remoteItems || []).map(remoteItem => {
      const localItem = localById.get(remoteItem.id)
      if (!localItem) return clone(remoteItem)
      localById.delete(remoteItem.id)
      const result = localItem.draft ? { ...remoteItem, ...localItem } : { ...localItem, ...remoteItem }
      if (isCancelled(remoteItem)) Object.assign(result, { status: 'CANCELADA', cancellationReason: remoteItem.cancellationReason, cancelledAt: remoteItem.cancelledAt, cancelledBy: remoteItem.cancelledBy, cancelledByRole: remoteItem.cancelledByRole })
      return result
    })
    return [...merged, ...[...localById.values()].filter(item => item.draft)]
  }
  function mergePlanFromRemote(localPlan, row) {
    localPlan.remoteId = row.id; localPlan.remoteUpdatedAt = row.updated_at || localPlan.remoteUpdatedAt
    localPlan.updatedAt = row.updated_at || localPlan.updatedAt; localPlan.createdAt = row.created_at || localPlan.createdAt
    localPlan.region = row.region || localPlan.region; localPlan.delegation = row.delegation || localPlan.delegation
    localPlan.registrantName = localPlan.registrantName || row.registrant_name || ''
    localPlan.registrantRole = localPlan.registrantRole || row.registrant_role || ''
    localPlan.registrantEmail = localPlan.registrantEmail || row.registrant_email || ''
    localPlan.registrantPhone = localPlan.registrantPhone || row.registrant_phone || ''
    localPlan.status = row.status || localPlan.status
    localPlan.activities = mergeRemoteActivities(localPlan.activities, activitiesFromRemote(row))
    persistLocal()
  }
  async function refreshSelectedPlanFromRemote() {
    const current = plan()
    if (delegationSession && selectedPlanPeriod === '2026-11') {
      const row = await api('/rest/v1/rpc/sat_my_november_plan', { method: 'POST', body: '{}' }, delegationSession.access_token)
      if (row) Object.assign(current, {
        remoteId: row.id, remoteUpdatedAt: row.updated_at, region: row.region,
        delegation: row.delegation, registrantName: row.registrant_name,
        registrantRole: row.registrant_role, registrantEmail: row.registrant_email,
        registrantPhone: row.registrant_phone, status: row.status,
        activities: row.activities || [], editToken: ''
      })
      else Object.assign(current, blankPlan(delegationAccount.delegation))
      const permission = await api(`/rest/v1/sat_plan_edit_permissions?period=eq.2026-11-01&delegation=eq.${encodeURIComponent(delegationAccount.delegation)}&select=enabled`, {}, delegationSession.access_token)
      delegationCanEdit = !row || row.status === 'BORRADOR' || permission[0]?.enabled === true
      persistLocal(); renderPlan(); setDelegationControls()
      return true
    }
    if (delegationSession && selectedPlanPeriod !== '2026-11') {
      const period = selectedPlanPeriod + '-01'
      const rows = await api(`/rest/v1/sat_monthly_plans?period=eq.${period}&delegation=eq.${encodeURIComponent(delegationAccount.delegation)}&select=*`, {}, delegationSession.access_token)
      if (!rows.length) {
        Object.assign(current, blankPlan(delegationAccount.delegation), { delegation: delegationAccount.delegation, region: regionFor(delegationAccount.delegation), status: 'BORRADOR' })
        delegationCanEdit = true
      } else {
        const row = rows[0]
        Object.assign(current, { remoteId: row.id, remoteUpdatedAt: row.updated_at, region: row.region, delegation: row.delegation, registrantName: row.registrant_name, registrantRole: row.registrant_role, registrantEmail: row.registrant_email, registrantPhone: row.registrant_phone, status: row.status, activities: row.activities || [], editToken: row.edit_token })
        const permission = await api(`/rest/v1/sat_plan_edit_permissions?period=eq.${period}&delegation=eq.${encodeURIComponent(delegationAccount.delegation)}&select=enabled`, {}, delegationSession.access_token)
        delegationCanEdit = row.status === 'BORRADOR' || permission[0]?.enabled === true
      }
      persistLocal()
      renderPlan()
      setDelegationControls()
      return true
    }
    if (!configured || !current.editToken) return false
    const query = current.remoteId ? `id=eq.${encodeURIComponent(current.remoteId)}` : `edit_token=eq.${encodeURIComponent(current.editToken)}`
    const rows = await api(`/rest/v1/${TABLE}?${query}&select=*`, {}, '', current.editToken)
    if (!rows?.length) return false
    mergePlanFromRemote(current, rows[0]); renderPlan(); return true
  }
  function connectionBanner() {
    const box = $('connection'); box.classList.add('visible', configured ? 'ok' : 'warning')
    box.textContent = configured ? 'Conexión activa. Al enviar, la DDT recibirá el plan.' : 'El formulario puede guardar un borrador en este dispositivo. El envío en línea estará disponible cuando se complete la conexión.'
  }
  function setupSelectors() {
    setOptions($('region'), Object.keys(REGIONS), regionFor(store.selectedDelegation))
    setOptions($('delegation'), REGIONS[$('region').value], store.selectedDelegation)
    $('region').addEventListener('change', () => {
      editingActivityId = null; editingSnapshot = null
      const first = REGIONS[$('region').value][0]
      store.selectedDelegation = first; setOptions($('delegation'), REGIONS[$('region').value], first); ensureSelectedPlan(); renderPlan(); refreshSelectedPlanFromRemote().catch(() => {})
    })
    $('delegation').addEventListener('change', () => { editingActivityId = null; editingSnapshot = null; store.selectedDelegation = $('delegation').value; ensureSelectedPlan(); renderPlan(); refreshSelectedPlanFromRemote().catch(() => {}) })
  }
  function ensureSelectedPlan() { plan(); persistLocal() }
  function bindProfile() {
    const map = { registrantName: 'registrantName', registrantRole: 'registrantRole', registrantEmail: 'registrantEmail', registrantPhone: 'registrantPhone' }
    Object.entries(map).forEach(([id, key]) => {
      $(id).value = plan()[key] || ''
      $(id).oninput = event => { clearFieldError(event.target); plan()[key] = event.target.value; saveLocalAndRender() }
    })
  }
  function renderPlan() {
    const current = plan(); current.region = regionFor(current.delegation)
    $('region').value = current.region
    if (!REGIONS[current.region].includes($('delegation').value)) setOptions($('delegation'), REGIONS[current.region], current.delegation)
    $('delegation').value = current.delegation
    bindProfile(); renderActivities(); renderSummary()
  }
  function renderSummary() {
    const current = plan()
    const savedActivities = activeActivities(current.activities)
    $('activityCount').textContent = savedActivities.length
    $('cancelledCount').textContent = cancelledActivities(current.activities).length
    $('participantCount').textContent = savedActivities.reduce((sum, item) => sum + (Number(item.projectedParticipants) || 0), 0).toLocaleString('es-NI')
    $('delegationMetric').textContent = current.delegation
    $('headerDelegationName').textContent = delegationAccount ? displayDelegationName(delegationAccount.delegation) : getAdminSession() ? 'Consola DDT' : 'Sin sesión'
    $('selectedPeriodLabel').textContent = `▣  ${periodLabel(selectedPlanPeriod)}`
    $('lastSaved').textContent = formatDateTime(current.updatedAt)
    $('activitiesHeading').textContent = 'Capacitaciones'
    $('emptyState').querySelector('p').textContent = `Agregá la primera capacitación de tu delegación para ${periodLabel(selectedPlanPeriod).toLocaleLowerCase('es-NI')}.`
    const sent = current.status === 'ENVIADO'
    const readonly = Boolean(delegationSession && !delegationCanEdit)
    $('planSendPanel').classList.toggle('is-readonly', readonly)
    if (delegationSession) {
      $('connection').textContent = sent
        ? readonly
          ? 'Plan enviado a la DDT. Podés consultarlo y descargarlo.'
          : 'Plan enviado a la DDT. Si tenés permiso, podés guardar cambios.'
        : 'Conexión activa. Al confirmar el envío, la DDT recibirá tu plan.'
    }
    $('planStatus').textContent = sent ? 'Enviado a la DDT' : current.remoteId ? 'Borrador guardado' : 'Borrador en este dispositivo'
    $('planStatus').classList.toggle('sent', current.status === 'ENVIADO')
    $('registrantHelp').textContent = readonly
      ? 'Este plan ya fue enviado. Los datos de quien registra se muestran como referencia y no se pueden cambiar.'
      : 'Escribí los datos de la persona responsable del plan. Los campos con * son necesarios.'
    $('activitiesHelp').textContent = readonly
      ? 'Este plan ya fue enviado a la DDT. Podés consultar las capacitaciones y descargarlo abajo.'
      : 'Agregá o editá las capacitaciones del mes. Cuando el plan esté completo, podrás enviarlo a la DDT.'
    $('help').hidden = readonly
    for (const id of ['saveDraftStep1', 'saveDraftStep2']) $(id).hidden = readonly
    const downloadReady = Boolean(delegationSession && sent && current.remoteId)
    $('downloadPanel').hidden = false
    $('downloadEyebrow').textContent = downloadReady ? 'Plan enviado' : 'Descargas del plan'
    $('downloadHeading').textContent = downloadReady ? 'Tu plan ya está listo para descargar' : 'Podrás descargar el plan después de enviarlo'
    $('downloadHelp').textContent = downloadReady
      ? 'La DDT recibió tu plan. Elegí el formato que necesitás.'
      : 'Las descargas estarán disponibles cuando envíes el plan a la DDT.'
    $('downloadWord').disabled = !downloadReady
    $('downloadExcel').disabled = !downloadReady
    $('submitStepTitle').textContent = sent ? 'Plan enviado a la DDT' : 'Enviar plan a la DDT'
    $('submitStepHelp').textContent = sent
      ? readonly
        ? 'La DDT recibió este plan. Podés consultarlo y descargarlo. Para hacer cambios, solicitá habilitación a la DDT.'
        : 'La DDT recibió este plan. Si hiciste cambios autorizados, confirmá para guardarlos.'
      : 'Cuando termines de cargar las capacitaciones, seleccioná “Enviar plan a la DDT”. El sistema te pedirá confirmar antes de enviarlo.'
    $('submitPlan').textContent = sent ? 'Guardar cambios' : 'Enviar plan a la DDT'
    if (delegationSession && sent && readonly) $('saveMessage').textContent = 'Plan enviado y guardado en el SAT. Está disponible para consulta y descarga.'
    updatePlanSendSummary()
  }
  function setDelegationControls() {
    if (!delegationSession || !delegationAccount) return
    const readonly = !delegationCanEdit
    $('delegationReadOnly').hidden = !readonly
    for (const id of ['addActivityTop', 'addFirst', 'submitPlan', 'saveDraftStep1', 'saveDraftStep2']) $(id).hidden = readonly
    for (const id of ['region', 'delegation', 'registrantName', 'registrantRole', 'registrantEmail', 'registrantPhone']) {
      const control = $(id)
      control.disabled = readonly || id === 'region' || id === 'delegation'
    }
    document.querySelectorAll('#activities input,#activities select,#activities textarea,#activities button,[data-save-activity]').forEach(control => { control.disabled = readonly })
    $('region').value = regionFor(delegationAccount.delegation)
    $('delegation').value = delegationAccount.delegation
    $('headerDelegationName').textContent = displayDelegationName(delegationAccount.delegation)
    $('delegationPeriod').value = selectedPlanPeriod
    $('submitPlan').disabled = readonly
    $('submitPlan').textContent = plan().status === 'ENVIADO' ? 'Guardar cambios' : 'Enviar plan a la DDT'
    renderSummary()
    if (readonly) $('planStatus').textContent = 'Enviado · Solo consulta'
  }
  function updatePlanSendSummary() {
    const current = plan()
    const activities = (current.activities || []).filter(item => !item.draft)
    const active = activities.filter(item => !isCancelled(item))
    const projected = active.reduce((sum, item) => sum + (Number(item.projectedParticipants) || 0), 0)
    const person = current.registrantName.trim() || 'persona responsable'
    $('planSendSummary').textContent = `${displayDelegationName(current.delegation)} · ${periodLabel(selectedPlanPeriod)} · ${activities.length} capacitación${activities.length === 1 ? '' : 'es'} registrada${activities.length === 1 ? '' : 's'} (${cancelledActivities(activities).length} cancelada${cancelledActivities(activities).length === 1 ? '' : 's'}) · ${projected.toLocaleString('es-NI')} participantes proyectados · a cargo de ${person}.`
  }
  function showDelegationStep(step, shouldScroll = true) {
    activeDelegationStep = Math.max(1, Math.min(2, Number(step) || 1))
    for (let number = 1; number <= 2; number += 1) {
      $(`delegationStep${number}`).hidden = number !== activeDelegationStep
      const progress = $(`stepProgress${number}`)
      const button = $(`stepNav${number}`)
      progress.classList.toggle('is-current', number === activeDelegationStep)
      progress.classList.toggle('is-complete', number < activeDelegationStep)
      if (number === activeDelegationStep) progress.setAttribute('aria-current', 'step')
      else progress.removeAttribute('aria-current')
      if (number === activeDelegationStep) button.setAttribute('aria-current', 'step')
      else button.removeAttribute('aria-current')
    }
    if (shouldScroll) {
      const heading = $(`delegationStep${activeDelegationStep}`).querySelector('h2')
      if (heading) {
        heading.setAttribute('tabindex', '-1')
        heading.focus({ preventScroll: true })
        heading.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    }
  }
  function saveDraftOnDevice() {
    plan().updatedAt = now()
    persistLocal()
    renderSummary()
    $('saveMessage').textContent = 'Borrador guardado en este dispositivo. Podés volver más tarde desde este mismo equipo.'
    toast('Borrador guardado en este dispositivo.')
  }
  function registrantStepIssues() {
    const current = plan(); const issues = []
    if (!current.registrantName.trim()) issues.push({ message: 'Escribí el nombre y apellido de quien llena el plan.', target: () => $('registrantName') })
    if (!current.registrantRole.trim()) issues.push({ message: 'Escribí el cargo de la persona que registra.', target: () => $('registrantRole') })
    if (!/^\S+@\S+\.\S+$/.test(current.registrantEmail)) issues.push({ message: 'Escribí un correo válido, por ejemplo nombre@intur.gob.ni.', target: () => $('registrantEmail') })
    if (!current.registrantPhone.trim()) issues.push({ message: 'Escribí un teléfono de contacto, por ejemplo 8888-0000.', target: () => $('registrantPhone') })
    return issues
  }
  function showIssuesInStep(issues, fallbackStep) {
    const ids = issues.map(issue => { try { return issue.target?.()?.id || '' } catch (_) { return '' } })
    const profileFields = ['registrantName', 'registrantRole', 'registrantEmail', 'registrantPhone']
    const step = ids.some(id => profileFields.includes(id)) ? 1 : fallbackStep
    showDelegationStep(step)
    showValidationIssues(issues)
  }
  function requestPlanSubmission() {
    const current = plan()
    const issues = validatePlan(current.status !== 'ENVIADO')
    if (issues.length) { showIssuesInStep(issues, 2); return }
    const alreadySent = current.status === 'ENVIADO'
    updatePlanSendSummary()
    $('submitConfirmTitle').textContent = alreadySent ? '¿Guardar los cambios del plan?' : '¿Enviar este plan a la DDT?'
    $('submitConfirmSummary').textContent = $('planSendSummary').textContent
    $('submitConfirmHelp').textContent = alreadySent
      ? 'La DDT ya recibió este plan. Confirmá para guardar los cambios autorizados.'
      : 'Después del envío, la DDT recibirá este plan. Podrás descargarlo cuando el sistema confirme que fue recibido.'
    $('confirmSubmitPlan').textContent = alreadySent ? 'Sí, guardar cambios' : 'Sí, enviar el plan'
    $('submitConfirmDialog').showModal()
  }
  function label(text, input, help = '', className = '') {
    const wrapper = document.createElement('label'); if (className) wrapper.className = className
    wrapper.append(document.createTextNode(text), input)
    if (help) { const small = document.createElement('span'); small.className = 'field-help'; small.textContent = help; wrapper.append(small) }
    return wrapper
  }
  function inputControl(value, type = 'text') { const input = document.createElement('input'); input.type = type; input.value = value ?? ''; return input }
  function selectControl(values, value) { const select = document.createElement('select'); select.append(new Option('Seleccionar', ''), ...values.map(item => new Option(item, item))); select.value = value || ''; return select }
  function bindActivityControl(control, item, key, type = 'text') {
    control.dataset.field = key
    const update = () => { clearFieldError(control); item[key] = type === 'number' ? Math.max(0, Number(control.value) || 0) : control.value; item.draft = true; document.querySelector(`[data-add-after="${item.id}"]`)?.setAttribute('disabled', ''); $('addActivityTop').disabled = true; saveLocalAndRender() }
    control.addEventListener('input', update)
    control.addEventListener('change', () => { update(); if (key === 'trainingProvider') renderActivities() })
    return control
  }
  function formatActivityDate(value) {
    if (!value) return '—'
    const [year, month, day] = String(value).split('-')
    return year && month && day ? `${day}/${month}/${year}` : value
  }
  function formatActivityTime(value) {
    if (!value) return '—'
    const [hourText, minuteText = '00'] = String(value).split(':')
    const hour = Number(hourText); if (!Number.isFinite(hour)) return value
    return `${String(hour % 12 || 12).padStart(2, '0')}:${minuteText} ${hour < 12 ? 'a. m.' : 'p. m.'}`
  }
  function renderActivityTable(root, items, current) {
    const canManage = !delegationSession || delegationCanEdit
    const visibleItems = items.filter(item => item.id !== editingActivityId)
    if (!visibleItems.length) return
    const wrapper = document.createElement('div'); wrapper.className = 'activities-table-wrap'
    const table = document.createElement('table'); table.className = 'activities-table'
    const icon = pathData => { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round'); const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', pathData); svg.append(path); return svg }
    const headers = ['#', 'Tema de capacitación', 'Fecha', 'Horario', 'Municipio', 'Lugar', 'Institución que imparte', 'Proyección', 'Estado', 'Acciones']
    const thead = document.createElement('thead'); const headerRow = document.createElement('tr')
    headers.forEach(value => headerRow.append(text('th', value))); thead.append(headerRow)
    const tbody = document.createElement('tbody')
    visibleItems.forEach((item, index) => {
      const cancelled = isCancelled(item); const row = document.createElement('tr'); if (cancelled) row.className = 'is-cancelled'
      const values = [String(index + 1), item.topic || 'Sin tema', formatActivityDate(item.date), `${formatActivityTime(item.startTime)} – ${formatActivityTime(item.endTime)}`, item.municipality || '—', item.location || '—', item.trainingProvider || '—', Number(item.projectedParticipants || 0).toLocaleString('es-NI'), cancelled ? 'Cancelada' : 'Registrada']
      values.forEach((value, cellIndex) => { const cell = document.createElement('td'); cell.dataset.label = headers[cellIndex]; if (cellIndex === 8) { const badge = text('span', value, cancelled ? 'cancelled-badge' : 'saved-pill'); cell.append(badge) } else if (cellIndex === 1 && cancelled) { cell.append(text('span', value), text('small', `Motivo: ${item.cancellationReason || 'No indicado'} · ${formatDateTime(item.cancelledAt)}`, 'cancelled-table-reason')) } else cell.textContent = value; row.append(cell) })
      const actions = document.createElement('td'); actions.dataset.label = 'Acciones'; actions.className = 'table-actions'
      if (!cancelled && canManage) {
        const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'table-action edit'; edit.append(icon('M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z')); edit.title = `Editar ${item.topic || 'capacitación'}`; edit.setAttribute('aria-label', edit.title)
        edit.onclick = () => { editingActivityId = item.id; editingSnapshot = clone(item); renderActivities() }
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'table-action delete'; remove.append(icon('M3 6h18 M8 6V4h8v2 M19 6l-1 14H6L5 6 M10 11v5 M14 11v5')); remove.title = `Eliminar ${item.topic || 'capacitación'}`; remove.setAttribute('aria-label', remove.title)
        remove.onclick = () => { if (confirm('¿Eliminar esta capacitación del plan?')) { const itemIndex = current.activities.findIndex(activity => activity.id === item.id); if (itemIndex >= 0) current.activities.splice(itemIndex, 1); saveLocalAndRender(); renderActivities() } }
        const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'table-action cancel'; cancel.textContent = '×'; cancel.title = `Cancelar ${item.topic || 'capacitación'}`; cancel.setAttribute('aria-label', cancel.title); cancel.disabled = !current.remoteId; cancel.onclick = () => openCancellation(current, item, 'delegate')
        actions.append(edit, remove, cancel)
      } else actions.textContent = cancelled ? '—' : 'Solo consulta'
      row.append(actions); tbody.append(row)
    })
    table.append(thead, tbody); wrapper.append(table); root.append(wrapper)
  }
  function renderActivities() {
    const root = $('activities'); root.replaceChildren(); const current = plan(); $('emptyState').hidden = current.activities.length > 0
    const savedActivities = current.activities.filter(item => !item.draft)
    renderActivityTable(root, savedActivities, current)
    $('addActivityTop').disabled = current.activities.some(item => item.draft) || Boolean(editingActivityId)
    current.activities.forEach((item, index) => {
      if (!item.draft && item.id !== editingActivityId) return
      const cancelled = isCancelled(item)
      const article = document.createElement('article'); article.className = `activity-card${cancelled ? ' is-cancelled' : ''}`; article.dataset.activityId = item.id
      const head = document.createElement('div'); head.className = 'activity-head'
      const title = document.createElement('strong'); title.textContent = `${editingActivityId === item.id ? 'Editar capacitación' : 'Nueva capacitación'} · ${index + 1}`
      const status = document.createElement('div'); status.className = 'activity-status'
      if (cancelled) status.append(text('span', 'CANCELADA', 'cancelled-badge'))
      else if (item.draft) { const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Eliminar borrador'; remove.onclick = () => { if (confirm('¿Quitar esta actividad que todavía no se ha guardado?')) { current.activities.splice(index, 1); saveLocalAndRender(); renderActivities() } }; status.append(remove) }
      else if (editingActivityId === item.id) { const cancelEdit = document.createElement('button'); cancelEdit.type = 'button'; cancelEdit.textContent = 'Descartar cambios'; cancelEdit.onclick = () => { const itemIndex = current.activities.findIndex(activity => activity.id === item.id); if (itemIndex >= 0 && editingSnapshot) current.activities[itemIndex] = editingSnapshot; editingActivityId = null; editingSnapshot = null; persistLocal(); renderActivities(); renderSummary() }; status.append(cancelEdit) }
      head.append(title, status)
      const grid = document.createElement('div'); grid.className = 'activity-grid'
      const activityType = bindActivityControl(selectControl(ACTIVITY_TYPES, item.activityType), item, 'activityType')
      const topic = bindActivityControl(inputControl(item.topic), item, 'topic'); topic.placeholder = 'Ej. Taller de elaboración de cócteles y aperitivos'
      const date = bindActivityControl(inputControl(item.date, 'date'), item, 'date')
      const [year, month] = selectedPlanPeriod.split('-').map(Number)
      date.min = `${selectedPlanPeriod}-01`
      date.max = `${selectedPlanPeriod}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`
      const extraDates = bindActivityControl(inputControl(item.additionalDates), item, 'additionalDates'); extraDates.placeholder = 'Ej. 03 y 04 de noviembre de 2026'
      const start = bindActivityControl(inputControl(item.startTime, 'time'), item, 'startTime')
      const end = bindActivityControl(inputControl(item.endTime, 'time'), item, 'endTime')
      const municipality = bindActivityControl(inputControl(item.municipality), item, 'municipality'); municipality.placeholder = 'Ej. Jinotepe'
      const location = bindActivityControl(inputControl(item.location), item, 'location'); location.placeholder = 'Nombre exacto del local o dirección'
      const modality = bindActivityControl(selectControl(MODALITIES, item.modality), item, 'modality')
      const provider = bindActivityControl(selectControl(PROVIDERS, item.trainingProvider), item, 'trainingProvider')
      const participants = bindActivityControl(inputControl(item.participatingInstitutions), item, 'participatingInstitutions'); participants.placeholder = 'Ej. Delegación INTUR Carazo e INATEC'
      const responsible = bindActivityControl(inputControl(item.responsible), item, 'responsible'); responsible.placeholder = 'Ej. INATEC'
      const projection = bindActivityControl(inputControl(item.projectedParticipants, 'number'), item, 'projectedParticipants', 'number'); projection.min = '0'
      const observations = document.createElement('textarea'); observations.value = item.observations || ''; observations.placeholder = 'Cambios previstos, coordinación pendiente u otra información relevante.'; bindActivityControl(observations, item, 'observations')
      grid.append(
        label('Tipo de actividad', activityType), label('Tema de capacitación', topic, '', 'wide'), label('Fecha principal', date),
        label('Fechas adicionales', extraDates, 'Solo si la misma capacitación se realizará durante varios días.', 'wide'), label('Hora de inicio', start), label('Hora de finalización', end),
        label('Municipio', municipality), label('Lugar', location, '', 'wide'), label('Modalidad', modality),
        label('Institución que imparte', provider), label('Participan', participants, 'Instituciones o actores que acompañan la actividad.', 'wide'), label('Responsable', responsible), label('Proyección de participantes', projection, '', 'projection-only')
      )
      grid.append(label('Observaciones', observations, '', 'full'))
      if (cancelled) {
        grid.querySelectorAll('input,select,textarea').forEach(control => { control.disabled = true })
        const reason = document.createElement('div'); reason.className = 'cancelled-reason'
        reason.textContent = `Motivo: ${item.cancellationReason || 'No indicado'} · Cancelada: ${formatDateTime(item.cancelledAt)}`
        grid.append(reason)
      }
      const actions = document.createElement('div'); actions.className = 'card-save'
      const save = document.createElement('button'); save.type = 'button'; save.className = 'button secondary'; save.textContent = editingActivityId === item.id ? 'Guardar cambios' : 'Guardar actividad'; save.dataset.saveActivity = item.id; save.onclick = () => saveActivity(item)
      if (!cancelled && item.draft) actions.append(save)
      article.append(head, grid, actions); root.append(article)
    })
  }
  function addActivity() { if (plan().activities.some(item => item.draft) || editingActivityId) return; plan().activities.push(blankActivity()); saveLocalAndRender(); renderActivities(); document.querySelector('.activity-card:last-child')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
  async function saveActivity(item) {
    const wasEditing = editingActivityId === item.id; const original = wasEditing ? editingSnapshot : null
    item.draft = false; if (wasEditing) { editingActivityId = null; editingSnapshot = null }
    const keepSubmitted = delegationSession && plan().status === 'ENVIADO'
    if (!keepSubmitted) plan().status = 'BORRADOR'
    plan().updatedAt = now(); persistLocal(); renderActivities(); renderSummary()
    $('saveMessage').textContent = keepSubmitted ? 'Cambios guardados en el plan enviado.' : 'Actividad guardada como borrador. Ya podés agregar otra actividad o continuar con el plan.'
    toast(keepSubmitted ? 'Cambios guardados en el plan enviado.' : 'Actividad guardada como borrador.')
    if (!validatePlan(false).length) {
      const saved = await savePlan(keepSubmitted ? 'ENVIADO' : 'BORRADOR')
      if (!saved) {
        const itemIndex = plan().activities.findIndex(activity => activity.id === item.id)
        if (wasEditing && original && itemIndex >= 0) { plan().activities[itemIndex] = original; editingActivityId = item.id; editingSnapshot = original }
        else item.draft = true
        persistLocal(); renderActivities(); renderSummary()
      }
    }
  }
  function clearFieldError(control) {
    if (!control) return
    const wrapper = control.closest('label') || control
    wrapper.classList.remove('field-invalid'); control.removeAttribute('aria-invalid')
    wrapper.querySelector('.field-error')?.remove()
  }
  function clearValidationErrors() {
    document.querySelectorAll('.field-invalid').forEach(element => element.classList.remove('field-invalid'))
    document.querySelectorAll('[aria-invalid="true"]').forEach(element => element.removeAttribute('aria-invalid'))
    document.querySelectorAll('.field-error').forEach(element => element.remove())
  }
  function markFieldError(control, message) {
    if (!control) return null
    const wrapper = control.closest('label') || control
    wrapper.classList.add('field-invalid'); control.setAttribute('aria-invalid', 'true')
    if (!wrapper.querySelector('.field-error')) { const note = document.createElement('span'); note.className = 'field-error'; note.textContent = message; wrapper.append(note) }
    return control
  }
  function activityControl(activityId, field) {
    return [...document.querySelectorAll('[data-activity-id]')].find(card => card.dataset.activityId === activityId)?.querySelector(`[data-field="${field}"]`)
  }
  function showValidationIssues(issues) {
    clearValidationErrors()
    let first = null
    issues.forEach(issue => { const target = markFieldError(issue.target?.(), issue.message); if (!first && target) first = target })
    if (first) {
      const focusFirstError = () => { first.scrollIntoView({ behavior: 'smooth', block: 'center' }); first.focus({ preventScroll: true }) }
      if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(focusFirstError)
      else setTimeout(focusFirstError, 0)
    }
    $('saveMessage').textContent = 'Completá los campos resaltados en rojo antes de enviar el plan.'
  }
  function validatePlan(finalSubmission = false) {
    const current = plan(); const issues = []
    const addIssue = (message, target, activityId = null) => issues.push({ message, target, activityId })
    if (!current.registrantName.trim()) addIssue('Indicá el nombre de quien registra.', () => $('registrantName'))
    if (!current.registrantRole.trim()) addIssue('Indicá el cargo.', () => $('registrantRole'))
    if (!/^\S+@\S+\.\S+$/.test(current.registrantEmail)) addIssue('Ingresá un correo válido.', () => $('registrantEmail'))
    if (!current.registrantPhone.trim()) addIssue('Indicá el teléfono.', () => $('registrantPhone'))
    if (!current.activities.length) addIssue('Agregá al menos una capacitación.', () => $('addFirst'))
    current.activities.forEach((item, index) => {
      if (item.draft) addIssue(`Guardá la actividad ${index + 1} antes de enviar.`, () => document.querySelector(`[data-save-activity="${item.id}"]`))
      const required = {
        activityType: 'Seleccioná el tipo de actividad', topic: 'Escribí el tema de la capacitación', date: 'Elegí la fecha principal',
        startTime: 'Indicá la hora de inicio', endTime: 'Indicá la hora de finalización', municipality: 'Escribí el municipio',
        location: 'Escribí el lugar exacto', modality: 'Seleccioná la modalidad', trainingProvider: 'Seleccioná quién impartirá la actividad',
        participatingInstitutions: 'Escribí qué instituciones participarán', responsible: 'Escribí quién será responsable'
      }
      Object.entries(required).forEach(([key, message]) => { if (!String(item[key] || '').trim()) addIssue(`${message} ${index + 1}.`, () => activityControl(item.id, key), item.id) })
      if (item.date && !String(item.date).startsWith(selectedPlanPeriod + '-')) addIssue('La fecha debe corresponder al mes seleccionado.', () => activityControl(item.id, 'date'), item.id)
      if (Number(item.projectedParticipants) <= 0) addIssue('Ingresá una proyección mayor que cero.', () => activityControl(item.id, 'projectedParticipants'), item.id)
    })
    const firstHiddenActivityIssue = finalSubmission && !current.activities.some(item => item.draft) && issues.find(issue => issue.activityId && !current.activities.find(item => item.id === issue.activityId)?.draft)
    if (firstHiddenActivityIssue && editingActivityId !== firstHiddenActivityIssue.activityId) {
      const activity = current.activities.find(item => item.id === firstHiddenActivityIssue.activityId)
      editingActivityId = activity.id; editingSnapshot = clone(activity); renderActivities()
    }
    return issues
  }
  function remotePayload(current, status) {
    return { region: current.region, delegation: current.delegation, registrant_name: current.registrantName.trim(), registrant_role: current.registrantRole.trim(), registrant_email: current.registrantEmail.trim(), registrant_phone: current.registrantPhone.trim(), activities: clone(current.activities), status, edit_token: current.editToken, updated_at: now() }
  }
  async function savePlan(status) {
    if (savingPlan) return false
    const current = plan()
    const finalSubmission = status === 'ENVIADO' && current.status !== 'ENVIADO'; const issues = validatePlan(finalSubmission)
    if (issues.length) { showIssuesInStep(issues, 2); toast('Completá los campos resaltados en rojo.'); return false }
    if (!configured) { persistLocal(); toast('Borrador local guardado. Falta conectar Supabase para registrar la información en línea.'); return false }
    const payload = remotePayload(current, status)
    if (delegationSession && selectedPlanPeriod !== '2026-11') {
      payload.period = selectedPlanPeriod + '-01'
    }
    savingPlan = true; const submit = $('submitPlan'); const submitText = submit.textContent
    submit.disabled = true; submit.textContent = status === 'ENVIADO' ? (current.status === 'ENVIADO' ? 'Guardando cambios…' : 'Enviando plan…') : submitText
    try {
      let rows
      const endpointTable = delegationSession && selectedPlanPeriod !== '2026-11' ? 'sat_monthly_plans' : TABLE
      const accessToken = delegationSession?.access_token || ''
      if (delegationSession && selectedPlanPeriod === '2026-11' && current.remoteId) delete payload.edit_token
      if (current.remoteId) {
        if (!current.remoteUpdatedAt) {
          const latest = await api(`/rest/v1/${endpointTable}?id=eq.${encodeURIComponent(current.remoteId)}&select=*`, {}, accessToken, delegationSession ? '' : current.editToken)
          if (!latest?.length) throw new Error('No se pudo verificar el plan en línea. Actualizá la página antes de guardar.')
          current.remoteUpdatedAt = latest[0].updated_at
        }
        rows = await api(`/rest/v1/${endpointTable}?id=eq.${encodeURIComponent(current.remoteId)}&updated_at=eq.${encodeURIComponent(current.remoteUpdatedAt)}&select=*`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(payload) }, accessToken, delegationSession ? '' : current.editToken)
      }
      else rows = await api(`/rest/v1/${endpointTable}?select=*`, { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ ...payload, created_at: now() }) }, accessToken, current.editToken)
      if (!rows?.length) throw new Error('No se guardó: el plan cambió desde la última consulta. Actualizá la página, revisá los cambios y volvé a guardar para no perder información.')
      const storedStatus = String(rows[0].status || '').toUpperCase()
      current.remoteId = rows[0].id; current.remoteUpdatedAt = rows[0].updated_at || now(); if (storedStatus) current.status = storedStatus; current.updatedAt = current.remoteUpdatedAt; persistLocal(); clearValidationErrors(); renderSummary()
      if (status === 'ENVIADO' && storedStatus !== 'ENVIADO') {
        $('saveMessage').textContent = 'El plan se guardó, pero el sistema todavía no confirmó que fue enviado. Las descargas seguirán deshabilitadas. Actualizá e intentá nuevamente; si continúa, contactá a la DDT.'
        toast('El envío todavía no fue confirmado por el sistema.')
        return false
      }
      $('saveMessage').textContent = status === 'ENVIADO' ? 'Plan enviado correctamente a la DDT.' : 'Borrador guardado en línea.'
      toast(status === 'ENVIADO' ? 'Plan enviado correctamente.' : 'Borrador guardado en línea.')
      if (status === 'ENVIADO' && delegationSession) {
        try { await refreshSelectedPlanFromRemote() }
        catch (_) { delegationCanEdit = false; setDelegationControls() }
      }
      return true
    } catch (error) {
      const message = error.status === 409 ? 'Esta delegación ya tiene un plan registrado desde otro navegador. Contactá a la DDT para recuperar el acceso.' : `No se pudo guardar: ${error.message}`
      $('saveMessage').textContent = message; toast(message)
      return false
    } finally { savingPlan = false; submit.disabled = false; submit.textContent = plan().status === 'ENVIADO' ? 'Guardar cambios' : submitText }
  }
  async function loadPlanForExcel(sourcePlan) {
    if (!configured) throw new Error('No hay conexión con Supabase para consultar el plan actualizado.')
    const delegatedViewActive = Boolean(delegationSession && $('adminView').hidden)
    if (delegatedViewActive) {
      if (selectedPlanPeriod === '2026-11') {
        const row = await api('/rest/v1/rpc/sat_my_november_plan', { method: 'POST', body: '{}' }, delegationSession.access_token)
        if (!row) throw new Error('No hay un plan de noviembre registrado.')
        return { ...row, period: '2026-11-01' }
      }
      const rows = await api(`/rest/v1/sat_monthly_plans?period=eq.${selectedPlanPeriod}-01&delegation=eq.${encodeURIComponent(delegationAccount.delegation)}&select=*`, {}, delegationSession.access_token)
      if (!rows.length) throw new Error('No hay un plan guardado para este mes.')
      return rows[0]
    }
    const delegationAccess = Boolean(!delegationSession && sourcePlan.remoteId && sourcePlan.editToken)
    const recordId = sourcePlan.remoteId || sourcePlan.id
    if (!recordId) throw new Error('El plan debe estar enviado a Supabase antes de descargarlo.')
    const adminSession = delegationAccess ? null : getAdminSession()
    if (!delegationAccess && !adminSession) throw new Error('La sesión administrativa expiró. Iniciá sesión nuevamente.')
    const exportTable = sourcePlan.legacy ? TABLE : sourcePlan.period ? 'sat_monthly_plans' : TABLE
    const rows = await api(`/rest/v1/${exportTable}?id=eq.${encodeURIComponent(recordId)}&select=*`, {}, adminSession?.accessToken || '', delegationAccess ? sourcePlan.editToken : '')
    if (!Array.isArray(rows) || rows.length !== 1) throw new Error('No se encontró el plan en Supabase con el acceso actual.')
    // Cada delegación es un único registro; activities contiene el arreglo completo sin paginación de filas.
    return { id: rows[0].id, period: rows[0].period || sourcePlan.period, delegation: rows[0].delegation, status: rows[0].status, activities: rows[0].activities || [] }
  }
  async function loadPlansForExcel() {
    if (!configured) throw new Error('No hay conexión con Supabase para consultar los planes enviados.')
    const adminSession = getAdminSession()
    if (!adminSession) throw new Error('La sesión administrativa expiró. Iniciá sesión nuevamente.')
    const endpoint = adminPeriod === '2026-11'
      ? `${TABLE}?status=eq.ENVIADO&select=*&order=delegation.asc`
      : `sat_monthly_plans?period=eq.${adminPeriod}-01&status=eq.ENVIADO&select=*&order=delegation.asc`
    const rows = await api(`/rest/v1/${endpoint}`, {}, adminSession.accessToken)
    if (!Array.isArray(rows) || !rows.length) throw new Error('No hay planes enviados disponibles para generar el Excel completo.')
    return rows.map(row => ({ ...row, period: row.period || `${adminPeriod}-01` }))
  }
  async function loadAllSubmittedPlans(token) {
    const pageSize = 500
    const plans = []
    let offset = 0
    while (true) {
      const end = offset + pageSize - 1
      const rows = await api(`/rest/v1/${TABLE}?status=eq.ENVIADO&select=*&order=delegation.asc`, { headers: { 'Range-Unit': 'items', Range: `${offset}-${end}` } }, token)
      if (!Array.isArray(rows)) throw new Error('Supabase devolvió una respuesta inesperada al consultar los planes enviados.')
      if (rows.length > pageSize) throw new Error('Supabase no respetó el rango de consulta; se detuvo la carga para evitar registros repetidos.')
      plans.push(...rows)
      if (rows.length < pageSize) break
      offset += pageSize
    }
    return plans
  }
  async function loadDdtActivities() {
    if (!configured) throw new Error('No hay conexión con Supabase para consultar el Plan DDT.')
    const session = getAdminSession()
    if (!session) throw new Error('La sesión administrativa expiró. Iniciá sesión nuevamente.')
    const plans = await loadAllSubmittedPlans(session.accessToken)
    const globalPlanActivities = plans.flatMap(row => (Array.isArray(row.activities) ? row.activities : [])
      .filter(activity => activity && !activity.draft && String(activity.date || '').startsWith('2026-11-'))
      .map(activity => ({ activity, delegation: row.delegation })))
    globalPlanActivities.sort((a, b) => String(a.activity.date || '').localeCompare(String(b.activity.date || '')) || String(a.activity.startTime || '').localeCompare(String(b.activity.startTime || '')) || String(a.delegation || '').localeCompare(String(b.delegation || ''), 'es', { sensitivity: 'base' }))
    const globalNumberByActivity = new Map(globalPlanActivities.map((entry, index) => [entry.activity, index + 1]))
    const seenIds = new Set()
    const activities = []
    plans.forEach(row => {
      if (row.status !== 'ENVIADO' || !Array.isArray(row.activities)) return
      row.activities.forEach(activity => {
        if (!activity || activity.draft || isCancelled(activity) || !/^2026-11-(0[1-9]|[12]\d|30)$/.test(String(activity.date || ''))) return
        if (String(activity.trainingProvider || '').trim() !== 'INTUR CENTRAL') return
        const activityId = activity.id == null ? '' : String(activity.id).trim()
        if (activityId && seenIds.has(activityId)) return
        if (activityId) seenIds.add(activityId)
        activities.push({ ...activity, globalNumber: globalNumberByActivity.get(activity), delegation: row.delegation, planStatus: row.status })
      })
    })
    return activities.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.startTime || '').localeCompare(String(b.startTime || '')) || String(a.delegation || '').localeCompare(String(b.delegation || ''), 'es', { sensitivity: 'base' }))
  }
  function ddtDateLabel(value) {
    const [year, month, day] = String(value || '').split('-').map(Number)
    if (!year || !month || !day) return 'Fecha pendiente de confirmar'
    const date = new Date(year, month - 1, day)
    const weekday = new Intl.DateTimeFormat('es-NI', { weekday: 'long' }).format(date)
    const monthLabel = new Intl.DateTimeFormat('es-NI', { month: 'long' }).format(date)
    return `${weekday[0].toLocaleUpperCase('es-NI')}${weekday.slice(1)} ${day} de ${monthLabel} de ${year}`
  }
  function ddtTimeLabel(value) {
    const raw = String(value || '').trim(), match = /^(\d{1,2}):(\d{2})$/.exec(raw)
    if (!match) return raw
    const hour = Number(match[1]), minute = Number(match[2])
    if (hour > 23 || minute > 59) return raw
    return `${String(hour % 12 || 12).padStart(2, '0')}:${match[2]} ${hour < 12 ? 'a. m.' : 'p. m.'}`
  }
  function renderDdtActivities(activities) {
    ddtActivities = activities
    const root = $('ddtActivityGroups'); root.replaceChildren()
    const isEmpty = activities.length === 0
    $('ddtSummary').hidden = isEmpty
    $('ddtEmpty').hidden = !isEmpty
    $('ddtActivityTotal').textContent = activities.length.toLocaleString('es-NI')
    $('ddtParticipantTotal').textContent = activities.reduce((sum, activity) => sum + (Number(activity.projectedParticipants) > 0 ? Number(activity.projectedParticipants) : 0), 0).toLocaleString('es-NI')
    $('downloadDdtWord').disabled = isEmpty
    const groups = new Map()
    activities.forEach(activity => { const list = groups.get(activity.date) || []; list.push(activity); groups.set(activity.date, list) })
    groups.forEach((items, date) => {
      const section = document.createElement('section'); section.className = 'ddt-date-group'
      const heading = document.createElement('div'); heading.className = 'ddt-date-heading'
      heading.append(text('h3', ddtDateLabel(date)), text('span', `${items.length} capacitación${items.length === 1 ? '' : 'es'}`))
      section.append(heading)
      items.forEach(activity => {
        const card = document.createElement('article'); card.className = 'ddt-activity-card'
        const cardHeading = document.createElement('div'); cardHeading.className = 'ddt-card-heading'
        cardHeading.append(text('h4', activity.topic || 'Pendiente de confirmar'), text('span', 'Enviado', 'admin-state sent'))
        const time = [activity.startTime, activity.endTime].filter(value => String(value || '').trim()).map(ddtTimeLabel).join(' – ') || 'Pendiente de confirmar'
        const projection = Number(activity.projectedParticipants) > 0 ? `${Number(activity.projectedParticipants).toLocaleString('es-NI')} personas` : 'Pendiente de confirmar'
        const fields = [
          ['Departamento', activity.delegation], ['Municipio', activity.municipality], ['Fecha y hora', `${ddtDateLabel(activity.date)} · ${time}`],
          ['Lugar', activity.location], ['Responsable', activity.responsible], ['Participan', activity.participatingInstitutions], ['Proyección', projection],
        ].filter(([name, value]) => name !== 'Municipio' || String(value || '').trim())
        const grid = document.createElement('div'); grid.className = 'ddt-activity-fields'
        fields.forEach(([name, value]) => grid.append(adminField(name, value || 'Pendiente de confirmar')))
        card.append(cardHeading, grid); section.append(card)
      })
      root.append(section)
    })
  }
  async function openPlanDdt() {
    if (!getAdminSession()) { toast('La sesión administrativa expiró. Iniciá sesión nuevamente.'); return }
    $('adminDashboard').hidden = true; $('planDdtView').hidden = false
    ddtActivities = []
    $('ddtLoading').hidden = false; $('ddtError').hidden = true; $('ddtSummary').hidden = true; $('ddtEmpty').hidden = true
    $('ddtActivityGroups').replaceChildren(); $('downloadDdtWord').disabled = true
    try {
      renderDdtActivities(await loadDdtActivities())
    } catch (error) {
      $('ddtError').textContent = error.message
      $('ddtError').hidden = false
    } finally { $('ddtLoading').hidden = true }
  }
  async function downloadDdtPlan(button) {
    const exporter = window.SATPlanExports?.ddtWord
    const originalLabel = button.textContent
    try {
      button.disabled = true; button.textContent = 'Actualizando datos…'
      const latest = await loadDdtActivities()
      renderDdtActivities(latest)
      if (!latest.length) { toast('No hay capacitaciones asignadas a INTUR CENTRAL para noviembre 2026.'); return }
      if (!exporter) throw new Error('No se pudo cargar el generador de Word. Actualizá la página e intentá nuevamente.')
      button.disabled = true; button.textContent = 'Generando Word…'
      await exporter(latest)
      toast('Plan DDT de noviembre 2026 descargado.')
    } catch (error) { toast(`No se pudo generar el Plan DDT: ${error.message}`) }
    finally { button.textContent = originalLabel; button.disabled = ddtActivities.length === 0 }
  }
  async function exportPlan(format, sourcePlan, button) {
    const exporter = window.SATPlanExports?.[format]
    if (!exporter) { toast('No se pudo preparar la descarga. Actualizá la página e intentá nuevamente.'); return }
    const label = button?.textContent
      const delegatedViewActive = Boolean(delegationSession && $('adminView').hidden)
      const requiresSubmittedPlan = Boolean(delegatedViewActive && ['word', 'excel'].includes(format))
    let submissionConfirmed = !requiresSubmittedPlan
    try {
      if (button) { button.disabled = true; button.textContent = format === 'image' ? 'Generando imagen…' : 'Generando documento…' }
      let exportSource = ['word', 'excel', 'image'].includes(format) ? await loadPlanForExcel(sourcePlan) : format === 'excelComplete' ? await loadPlansForExcel() : sourcePlan
      if (requiresSubmittedPlan) {
        if (exportSource?.status !== 'ENVIADO') {
          $('downloadWord').disabled = true
          $('downloadExcel').disabled = true
          throw new Error('Las descargas estarán disponibles cuando envíes el plan a la DDT y el sistema confirme que fue recibido.')
        }
        submissionConfirmed = true
      }
      const period = `${delegatedViewActive ? selectedPlanPeriod : adminPeriod}-01`
      if (Array.isArray(exportSource)) exportSource = exportSource.map(row => ({ ...row, period: row.period || period }))
      else exportSource = { ...exportSource, period: exportSource.period || period }
      await exporter(exportSource); toast(`Plan mensual en ${format === 'word' ? 'Word' : format === 'image' ? 'imagen PNG' : 'Excel'} generado.`)
    }
    catch (error) { toast(`No se pudo generar el documento: ${error.message}`) }
    finally { if (button) setTimeout(() => { button.disabled = requiresSubmittedPlan ? !submissionConfirmed : false; button.textContent = label }, 350) }
  }
  function exportForSatCentral(button) {
    const plans = adminRows.filter(row => row.status === 'ENVIADO')
    const activities = plans.flatMap(row => (row.activities || []).filter(activity => !activity.draft && !isCancelled(activity)).map(activity => ({
      sourceId: activity.id, delegation: row.delegation, topic: String(activity.topic || '').trim(), activityType: activity.activityType || 'Capacitación',
      date: activity.date || '', time: activity.startTime || '', municipality: activity.municipality || '', location: activity.location || '',
      responsible: activity.responsible || '', institution: activity.participatingInstitutions || '', modality: activity.modality || 'Presencial',
      trainingProvider: activity.trainingProvider === 'INTUR CENTRAL' ? 'DDT (INTUR)' : (activity.trainingProvider || ''),
      ddtFacilitator: activity.ddtFacilitator || '', projectedParticipants: Number(activity.projectedParticipants) || 0,
      observations: [activity.observations || '', activity.additionalDates ? `Fechas adicionales: ${activity.additionalDates}` : ''].filter(Boolean).join(' · '),
    })))
    const payload = { format: 'sat-intur-monthly-plan', version: 1, source: 'SAT Plan Capacitaciones', period: '2026-11', exportedAt: now(), activities }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), url = URL.createObjectURL(blob), link = document.createElement('a')
    link.href = url; link.download = 'SAT_Plan_Capacitaciones_noviembre_2026.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast(`${activities.length} capacitaciones listas para importar en SAT Central.`)
  }
  async function adminLogin(event) {
    event.preventDefault(); $('adminError').textContent = ''
    if (!configured) { $('adminError').textContent = 'Primero debe configurarse la conexión con Supabase.'; return }
    if ($('adminUsername').value.trim().toUpperCase() !== String(CONFIG.adminUsername || '').toUpperCase()) { $('adminError').textContent = 'Usuario o contraseña incorrectos.'; return }
    try {
      const session = await api('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email: CONFIG.adminEmail, password: $('adminPassword').value }) })
      sessionStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify({ accessToken: session.access_token, expiresAt: Date.now() + (session.expires_in * 1000) }))
      $('adminPassword').value = ''; $('adminDialog').close(); await showAdmin(session.access_token)
    } catch (_) { $('adminError').textContent = 'Usuario o contraseña incorrectos.' }
  }
  function getAdminSession() { try { const value = JSON.parse(sessionStorage.getItem(ADMIN_SESSION_KEY) || 'null'); return value && value.expiresAt > Date.now() ? value : null } catch (_) { return null } }
  function setupDelegationAccess() {
    const login = $('satDelegationLogin'), change = $('satPasswordChange')
    const message = $('satAccessMessage')
    const logout = $('satDelegationLogout'), changeButton = $('satChangePassword')
    const sessionActions = $('satDelegationSessionActions')
    let session = null
    setOptions($('satDelegationName'), DELEGATIONS, '')
    $('satDelegationName').insertBefore(new Option('Seleccioná tu delegación', ''), $('satDelegationName').firstChild)
    $('satDelegationName').value = ''
    $('satPasswordVisibility').onclick = () => {
      const password = $('satDelegationPassword')
      const visible = password.type === 'password'
      password.type = visible ? 'text' : 'password'
      $('satPasswordVisibility').textContent = visible ? 'Ocultar' : 'Mostrar'
      $('satPasswordVisibility').setAttribute('aria-label', visible ? 'Ocultar contraseña' : 'Mostrar contraseña')
      $('satPasswordVisibility').setAttribute('aria-pressed', String(visible))
    }
    const rpc = (name, token, body = {}) => api('/rest/v1/rpc/' + name, {
      method: 'POST', body: JSON.stringify(body)
    }, token)
    function showForcedPasswordChange(account) {
      delegationAccount = account
      delegationSession = session
      $('headerDelegationName').textContent = displayDelegationName(account.delegation)
      login.hidden = true
      change.hidden = false
      changeButton.hidden = true
      $('satDelegationAccess').append(logout)
      logout.hidden = false
      sessionActions.hidden = true
      message.textContent = 'Cambiá la contraseña temporal para continuar.'
    }
    async function showAccount() {
      const [account] = await rpc('sat_my_account', session.access_token)
      if (!account) throw new Error('Acceso de delegación deshabilitado.')
      delegationAccount = account
      delegationSession = session
      login.hidden = true
      logout.hidden = false
      change.hidden = !account.must_change_password
      changeButton.hidden = account.must_change_password
      if (account.must_change_password) {
        showForcedPasswordChange(account)
        return
      }
      message.textContent = account.delegation
      $('satDelegationAccess').hidden = true
      $('delegateView').hidden = false
      sessionActions.append(changeButton, logout)
      sessionActions.hidden = false
      $('region').value = regionFor(account.delegation)
      $('delegation').value = account.delegation
      store.selectedDelegation = account.delegation
      $('selectedPeriodLabel').hidden = true
      selectedPlanPeriod = $('delegationPeriod').value || '2026-11'
      await refreshSelectedPlanFromRemote()
      setDelegationControls()
      showDelegationStep(1, false)
    }
    login.onsubmit = async event => {
      event.preventDefault()
      const password = $('satDelegationPassword')
      const submit = login.querySelector('button[type="submit"]')
      const user = $('satDelegationName').value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replaceAll(' ', '-')
      message.textContent = ''
      password.removeAttribute('aria-invalid')
      submit.disabled = true
      submit.textContent = 'Ingresando…'
      try {
        session = await api('/auth/v1/token?grant_type=password', {
          method: 'POST', body: JSON.stringify({ email: user + '@delegaciones.intur.local', password: password.value })
        })
        const [account] = await rpc('sat_my_account', session.access_token)
        if (account?.must_change_password) {
          showForcedPasswordChange(account)
        } else await showAccount()
      } catch (error) { message.textContent = error.message; password.setAttribute('aria-invalid', 'true') }
      finally { password.value = ''; submit.disabled = false; submit.textContent = 'Ingresar' }
    }
    changeButton.onclick = () => {
      $('satDelegationAccess').append(changeButton, logout)
      sessionActions.hidden = true
      $('satDelegationAccess').hidden = false
      $('delegateView').hidden = true
      login.hidden = true
      change.hidden = false
    }
    change.onsubmit = async event => {
      event.preventDefault()
      const password = $('satNewPassword')
      try {
        await api('/auth/v1/user', { method: 'PUT', body: JSON.stringify({ password: password.value }) }, session.access_token)
        await rpc('sat_complete_password_change', session.access_token)
        await showAccount()
      } catch (error) { message.textContent = error.message }
      finally { password.value = '' }
    }
    logout.onclick = async () => {
      const token = session?.access_token
      session = null
      delegationSession = null; delegationAccount = null; selectedPlanPeriod = '2026-11'; delegationCanEdit = false
      $('delegationPeriod').value = selectedPlanPeriod
      $('selectedPeriodLabel').hidden = false
      showDelegationStep(1, false)
      change.hidden = logout.hidden = changeButton.hidden = true
      sessionActions.append(changeButton, logout)
      sessionActions.hidden = true
      login.hidden = false
      $('satDelegationAccess').hidden = false
      $('delegateView').hidden = true
      $('headerDelegationName').textContent = 'Sin sesión'
      message.textContent = ''
      if (token) try { await api('/auth/v1/logout', { method: 'POST' }, token) }
      catch (error) { message.textContent = error.message }
    }
    function showTemporaryPasswords(credentials) {
      const dialog = $('satPasswordRevealDialog'), root = $('satPasswordRevealList')
      const entries = credentials.filter(item => item?.temporaryPassword)
      if (!entries.length) return
      root.replaceChildren(...entries.map(item => {
        const row = text('div', '', 'sat-password-reveal-row')
        row.append(text('strong', displayDelegationName(item.delegation)))
        const value = text('code', item.temporaryPassword)
        const copy = adminButton('Copiar contraseña', async () => {
          try { await navigator.clipboard.writeText(item.temporaryPassword); copy.textContent = 'Copiada' }
          catch (_) { copy.textContent = 'No se pudo copiar'; toast('Seleccioná la clave y copiala manualmente antes de cerrar.') }
        }, 'button secondary')
        row.append(value, copy)
        return row
      }))
      if (credentials.length === 1) $('satPasswordRevealTitle').textContent = `Guardá la contraseña de ${displayDelegationName(entries[0].delegation)} ahora`
      else $('satPasswordRevealTitle').textContent = `Guardá las ${entries.length} contraseñas temporales ahora`
      dialog.showModal()
    }
    function renderPasswordHistory(rows) {
      const root = $('satPasswordHistoryList')
      if (!rows.length) { root.textContent = 'Todavía no hay restablecimientos registrados.'; return }
      const list = document.createElement('div'); list.className = 'password-history-list'
      rows.forEach(row => {
        const entry = document.createElement('div'); entry.className = 'password-history-row'
        entry.append(
          text('strong', displayDelegationName(row.delegation)),
          text('span', formatDateTime(row.created_at)),
          text('span', row.admin_email || 'Administrador'),
          text('span', row.outcome === 'EXITOSO' ? 'Completado' : row.outcome === 'FALLIDO' ? 'No completado' : 'En curso', `password-history-outcome ${String(row.outcome || '').toLowerCase()}`)
        )
        list.append(entry)
      })
      root.replaceChildren(list)
    }
    async function loadPasswordHistory(admin) {
      const root = $('satPasswordHistoryList')
      root.textContent = 'Cargando historial…'
      try {
        const delegation = $('satPasswordHistoryFilter').value || null
        const rows = await rpc('sat_admin_password_reset_history', admin.accessToken, { p_delegation: delegation })
        renderPasswordHistory(rows.filter(row => DELEGATIONS.includes(row.delegation)))
      } catch (error) {
        root.textContent = error.status === 404
          ? 'El historial seguro todavía no está disponible. Actualizá la aplicación después de habilitar el registro en Supabase.'
          : `No se pudo cargar el historial: ${error.message}`
      }
    }
    const refreshSatAccounts = async () => {
      const admin = getAdminSession()
      if (!admin) return
      $('satAccounts').hidden = false
      const accounts = $('satAccountsList'), status = $('satAccountsMessage')
      accounts.replaceChildren()
      status.textContent = ''
      try {
        const rows = (await rpc('sat_admin_accounts', admin.accessToken)).filter(row => DELEGATIONS.includes(row.delegation))
        const filter = $('satPasswordHistoryFilter')
        const selectedFilter = filter.value
        filter.replaceChildren(new Option('Todas', ''), ...rows.map(row => new Option(displayDelegationName(row.delegation), row.delegation)))
        filter.value = rows.some(row => row.delegation === selectedFilter) ? selectedFilter : ''
        for (const row of rows) {
          const accountLabel = displayDelegationName(row.delegation)
          const line = text('div', `Usuario: ${accountLabel} · ${row.enabled ? 'Habilitada' : 'Deshabilitada'} · Último acceso: ${formatDateTime(row.last_sign_in_at)}`, 'sat-account-row')
          line.append(adminButton(row.provisioned ? 'Restablecer contraseña' : 'Crear cuenta', async event => {
            const button = event.currentTarget
            button.disabled = true
            try {
              if (row.provisioned && !window.confirm('Se cambiará la clave actual por una temporal nueva y la delegación deberá crear otra al ingresar. ¿Restablecer la contraseña de ' + row.delegation + '?')) { button.disabled = false; return }
              const result = await api('/functions/v1/sat-accounts', {
                method: 'POST', body: JSON.stringify({ delegation: row.delegation, action: row.provisioned ? 'reset' : 'create' })
              }, admin.accessToken)
              if (result.verified !== true) throw new Error('La cuenta no confirmó las pruebas de acceso.')
              await refreshSatAccounts()
              if (row.provisioned) await loadPasswordHistory(getAdminSession())
              status.textContent = `${displayDelegationName(result.delegation)} · ${row.provisioned ? 'Contraseña restablecida' : 'Cuenta creada'}. Guardá la clave temporal ahora; no quedará guardada en el SAT.${result.auditPending ? ' El registro del historial está pendiente de confirmación.' : ''}`
              showTemporaryPasswords([result])
            } catch (error) {
              status.textContent = error.message
              button.disabled = false
            }
          }))
          if (row.provisioned && !row.enabled) line.append(adminButton('Habilitar', async () => {
            try {
              await rpc('sat_admin_enable_account', admin.accessToken, { target: row.delegation, active: true })
              await refreshSatAccounts()
            } catch (error) { status.textContent = error.message }
          }))
          accounts.append(line)
        }
      } catch (error) { status.textContent = error.message }
      await loadPasswordHistory(admin)
    }
    $('satAccountsLink').onclick = refreshSatAccounts
    $('satPasswordHistoryFilter').onchange = async () => {
      const admin = getAdminSession()
      if (admin) await loadPasswordHistory(admin)
    }
    const passwordRevealDialog = $('satPasswordRevealDialog')
    const clearReveal = () => $('satPasswordRevealList').replaceChildren()
    passwordRevealDialog.addEventListener('close', clearReveal)
    $('satPasswordRevealClose').onclick = () => passwordRevealDialog.close()
    $('satPasswordRevealDone').onclick = () => passwordRevealDialog.close()
  }
  function setupDelegationPeriodPicker() {
    const picker = $('delegationPeriodPicker')
    const toggle = $('delegationPeriodToggle')
    const panel = $('delegationPeriodPanel')
    let browseYear = 2026
    let loading = false
    const selected = () => selectedPlanPeriod.split('-').map(Number)
    const render = () => {
      const [year, month] = selected()
      $('delegationPeriodText').textContent = periodLabel(selectedPlanPeriod)
      $('delegationPeriodPanelTitle').textContent = String(browseYear)
      $('delegationYearPrev').disabled = loading || browseYear <= 1
      $('delegationYearNext').disabled = loading || browseYear >= 9999
      $('delegationPeriodPrev').disabled = loading || (year === 1 && month === 1)
      $('delegationPeriodNext').disabled = loading || (year === 9999 && month === 12)
      $('delegationPeriodToday').disabled = loading
      $('delegationMonths').replaceChildren(...periodMonths.map((name, index) => {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'delegate-month-choice'
        button.textContent = name
        button.disabled = loading
        button.setAttribute('aria-pressed', String(browseYear === year && index + 1 === month))
        button.onclick = () => void choose(browseYear, index + 1)
        return button
      }))
    }
    const close = () => { panel.hidden = true; toggle.setAttribute('aria-expanded', 'false') }
    async function choose(year, month) {
      if (loading || year < 1 || year > 9999 || month < 1 || month > 12) return
      const nextPeriod = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`
      const changed = nextPeriod !== selectedPlanPeriod
      browseYear = year
      if (!changed) { render(); close(); toggle.focus(); return }
      selectedPlanPeriod = nextPeriod
      $('delegationPeriod').value = selectedPlanPeriod
      $('selectedPeriodLabel').textContent = `▣  ${periodLabel(selectedPlanPeriod)}`
      editingActivityId = null; editingSnapshot = null
      showDelegationStep(1, false)
      ensureSelectedPlan()
      renderPlan()
      render(); close(); toggle.focus()
      if (!delegationSession) return
      loading = true; render()
      $('saveMessage').textContent = `Buscando el plan de ${periodLabel(selectedPlanPeriod)}. Los demás meses se conservan por separado.`
      try {
        await refreshSelectedPlanFromRemote()
        setDelegationControls()
        $('saveMessage').textContent = plan().remoteId ? 'Se abrió el plan guardado de este mes.' : 'Este mes todavía no tiene un plan guardado. Podés empezar uno nuevo.'
      } catch (error) {
        $('saveMessage').textContent = `No se pudo cargar este mes: ${error.message}. Los demás meses siguen guardados.`
      } finally { loading = false; render() }
    }
    const stepMonth = offset => {
      const [year, month] = selected()
      const monthIndex = (year - 1) * 12 + month - 1 + offset
      void choose(Math.floor(monthIndex / 12) + 1, monthIndex % 12 + 1)
    }
    $('delegationPeriodPrev').onclick = () => stepMonth(-1)
    $('delegationPeriodNext').onclick = () => stepMonth(1)
    $('delegationYearPrev').onclick = () => { if (browseYear > 1) { browseYear -= 1; render() } }
    $('delegationYearNext').onclick = () => { if (browseYear < 9999) { browseYear += 1; render() } }
    $('delegationPeriodToday').onclick = () => { const today = new Date(); void choose(today.getFullYear(), today.getMonth() + 1) }
    toggle.onclick = () => {
      if (!panel.hidden) { close(); return }
      browseYear = selected()[0]; render(); panel.hidden = false; toggle.setAttribute('aria-expanded', 'true')
    }
    picker.addEventListener('keydown', event => { if (event.key === 'Escape' && !panel.hidden) { close(); toggle.focus() } })
    document.addEventListener('click', event => { if (!picker.contains(event.target)) close() })
    $('delegationPeriod').value = selectedPlanPeriod
    render()
  }
  function setupAdminPeriodPicker() {
    const picker = $('adminPeriodPicker'), toggle = $('periodToggle'), panel = $('periodPanel')
    let browseYear = 2026
    const selected = () => adminPeriod.split('-').map(Number)
    const render = () => {
      const [year, month] = selected()
      $('periodMonth').textContent = periodMonths[month - 1]
      $('periodYear').textContent = year
      $('periodBrowseYear').textContent = browseYear
      $('periodYearPrev').disabled = browseYear <= 1
      $('periodYearNext').disabled = browseYear >= 9999
      $('periodPrev').disabled = year === 1 && month === 1
      $('periodNext').disabled = year === 9999 && month === 12
      $('periodMonths').replaceChildren(...periodMonths.map((name, index) => {
        const button = adminButton(name, () => choose(browseYear, index + 1), '')
        button.setAttribute('aria-pressed', String(browseYear === year && index + 1 === month))
        return button
      }))
    }
    const close = () => { panel.hidden = true; toggle.setAttribute('aria-expanded', 'false') }
    function choose(year, month) {
      adminPeriod = String(year).padStart(4, '0') + '-' + String(month).padStart(2, '0')
      browseYear = year
      render()
      if (!panel.hidden) { close(); toggle.focus() }
      const session = getAdminSession()
      if (session) void showAdmin(session.accessToken)
    }
    const step = offset => {
      const [year, month] = selected()
      const index = year * 12 + month - 1 + offset
      choose(Math.floor(index / 12), index % 12 + 1)
    }
    $('periodPrev').onclick = () => step(-1)
    $('periodNext').onclick = () => step(1)
    $('periodYearPrev').onclick = () => { browseYear--; render() }
    $('periodYearNext').onclick = () => { browseYear++; render() }
    toggle.onclick = () => {
      if (!panel.hidden) { close(); return }
      browseYear = selected()[0]; render()
      panel.hidden = false; toggle.setAttribute('aria-expanded', 'true')
    }
    picker.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !panel.hidden) { close(); toggle.focus() }
    })
    document.addEventListener('click', event => { if (!picker.contains(event.target)) close() })
    render()
  }
  async function showAdmin(token) {
    $('headerDelegationName').textContent = 'Consola DDT'
    $('selectedPeriodLabel').hidden = false
    $('satAccountsLink').hidden = false
    $('satDelegationAccess').hidden = true
    $('delegateView').hidden = true; $('adminView').hidden = false
    const period = adminPeriod
    const legacy = period === '2026-11'
    $('adminPeriodHeading').textContent = 'Seguimiento del Plan de ' + $('periodMonth').textContent + ' ' + $('periodYear').textContent
    $('adminDownloadComplete').textContent = `▣ Descargar plan completo ${periodLabel(period).toLocaleLowerCase('es-NI')}`
    $('adminDownloadExcelComplete').textContent = `▦ Descargar Excel completo ${periodLabel(period).toLocaleLowerCase('es-NI')}`
    $('adminPeriodNotice').hidden = legacy
    for (const id of ['assignDdtStaff', 'adminCancelledOpen', 'adminPlanDdt']) $(id).disabled = !legacy
    const endpoint = legacy ? TABLE + '?select=*' : 'sat_monthly_plans?period=eq.' + period + '-01&select=*'
    const request = ++adminRequest
    adminRows = []
    renderAdmin()
    renderCancelledReport()
    try {
      const rows = await api('/rest/v1/' + endpoint + '&order=updated_at.desc', {}, token)
      if (request !== adminRequest || !getAdminSession()) return
      adminRows = rows.map(row => ({ ...row, period: row.period || `${period}-01`, legacy }))
      adminRows.forEach(row => (row.activities || []).forEach(normalizeActivityProvider))
      renderAdmin()
      renderCancelledReport()
    } catch (error) {
      if (request === adminRequest) toast('No se pudo abrir el informe: ' + error.message)
    }
  }
  function text(tag, value, className = '') { const node = document.createElement(tag); node.textContent = value; if (className) node.className = className; return node }
  const ADMIN_FIELDS = [
    ['activityType', 'Tipo', 'select', ACTIVITY_TYPES], ['topic', 'Tema de capacitación', 'text'],
    ['date', 'Fecha principal', 'date'], ['additionalDates', 'Fechas adicionales', 'text'],
    ['startTime', 'Hora inicio', 'time'], ['endTime', 'Hora final', 'time'],
    ['municipality', 'Municipio', 'text'], ['location', 'Lugar', 'text'],
    ['modality', 'Modalidad', 'select', MODALITIES], ['trainingProvider', 'Institución que imparte', 'select', PROVIDERS],
    ['participatingInstitutions', 'Instituciones participantes', 'text'], ['responsible', 'Responsable', 'text'],
    ['ddtFacilitator', 'Facilitador/a INTUR CENTRAL', 'text'], ['projectedParticipants', 'Proyección de participantes', 'number'],
    ['observations', 'Observaciones', 'textarea']
  ]
  function adminButton(labelText, action, className = 'button ghost') {
    const button = document.createElement('button'); button.type = 'button'; button.className = className; button.textContent = labelText; button.onclick = action; return button
  }
  function adminField(name, value) {
    const cell = document.createElement('div'); cell.className = 'admin-data-field'
    cell.append(text('small', name), text('b', String(value ?? '').trim() || '—')); return cell
  }
  async function saveAdminRow(row, updates, description) {
    const session = getAdminSession()
    if (!session) { toast('La sesión expiró. Iniciá sesión nuevamente.'); return false }
    try {
      // Control de concurrencia: no sobrescribir un plan modificado por la delegación u otro administrador.
      const endpoint = `/rest/v1/${row.legacy ? TABLE : row.period ? 'sat_monthly_plans' : TABLE}?id=eq.${encodeURIComponent(row.id)}&updated_at=eq.${encodeURIComponent(row.updated_at)}&select=*`
      const result = await api(endpoint, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(updates) }, session.accessToken)
      if (!result?.length) { toast('No se guardó: el registro cambió desde que lo abriste. Presioná Actualizar antes de editar.'); return false }
      Object.assign(row, result[0]); toast(description); renderAdmin(row.id); return true
    } catch (error) { toast(`No se pudo guardar: ${error.message}`); return false }
  }
  function isCentralTraining(activity) { return String(activity?.trainingProvider || '').trim().toUpperCase() === 'INTUR CENTRAL' }
  function facilitatorKey(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/^cra\.?\s+/i, '')
      .toLocaleLowerCase('es-NI')
  }
  function assignmentSelect(value) {
    const select = document.createElement('select')
    select.append(new Option('Sin asignar', ''), ...DDT_FACILITATORS.map(person => new Option(person, person)))
    const canonical = DDT_FACILITATORS.find(person => facilitatorKey(person) === facilitatorKey(value)) || value || ''
    if (canonical && !DDT_FACILITATORS.includes(canonical)) select.add(new Option(canonical, canonical))
    select.value = canonical
    return select
  }
  function renderAssignments() {
    const root = $('assignmentList'); root.replaceChildren()
    const assignments = adminRows.flatMap(row => (row.activities || []).map((activity, index) => ({ row, activity, index })).filter(({ activity }) => isCentralTraining(activity) && !isCancelled(activity)))
    if (!assignments.length) {
      root.append(text('div', 'Aún no hay capacitaciones registradas con “INTUR CENTRAL” como institución que imparte.', 'assignment-empty'))
      return
    }
    const heading = document.createElement('div'); heading.className = 'assignment-calendar-heading'
    heading.append(text('strong', 'Noviembre 2026'), text('small', `${assignments.length} capacitación${assignments.length === 1 ? '' : 'es'} de INTUR CENTRAL por asignar o revisar.`))
    const inNovember = entry => /^2026-11-(0[1-9]|[12]\d|30)$/.test(entry.activity.date || '')
    const assignedCount = Object.fromEntries(DDT_FACILITATORS.map(person => [facilitatorKey(person), 0]))
    assignments.filter(inNovember).forEach(entry => {
      const key = facilitatorKey(entry.activity.ddtFacilitator)
      if (Object.prototype.hasOwnProperty.call(assignedCount, key)) assignedCount[key] += 1
    })
    const counter = document.createElement('section'); counter.className = 'assignment-counter'; counter.setAttribute('aria-label', 'Capacitaciones asignadas por facilitador DDT')
    DDT_FACILITATORS.forEach(person => {
      const badge = document.createElement('div'); badge.className = 'assignment-counter-item'
      const count = assignedCount[facilitatorKey(person)] || 0
      badge.append(text('span', person), text('strong', `${count} capacitación${count === 1 ? '' : 'es'}`))
      counter.append(badge)
    })
    const calendar = document.createElement('section'); calendar.className = 'assignment-calendar'; calendar.setAttribute('aria-label', 'Calendario de asignación DDT de noviembre de 2026')
    ;['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].forEach(day => calendar.append(text('div', day, 'assignment-weekday')))
    const byDate = new Map(), withoutDate = []
    assignments.forEach(entry => {
      if (inNovember(entry)) {
        const entries = byDate.get(entry.activity.date) || []; entries.push(entry); byDate.set(entry.activity.date, entries)
      } else withoutDate.push(entry)
    })
    for (let day = 1; day <= 30; day += 1) {
      const key = `2026-11-${String(day).padStart(2, '0')}`
      const cell = document.createElement('div'); cell.className = 'assignment-day'
      cell.append(text('span', String(day), 'assignment-day-number'))
      ;(byDate.get(key) || []).forEach(entry => cell.append(assignmentCard(entry)))
      calendar.append(cell)
    }
    root.append(heading, counter, calendar)
    if (withoutDate.length) {
      const pending = document.createElement('section'); pending.className = 'assignment-pending'
      pending.append(text('strong', 'Capacitaciones sin fecha válida de noviembre'))
      withoutDate.forEach(entry => pending.append(assignmentCard(entry)))
      root.append(pending)
    }
  }
  function assignmentCard({ row, activity, index }) {
    const card = document.createElement('article'); card.className = 'assignment-card'
    const heading = document.createElement('div'); heading.className = 'assignment-heading'
    heading.append(text('strong', activity.topic || 'Capacitación sin tema'), text('small', `${row.delegation}${activity.municipality ? ` · ${activity.municipality}` : ''}${activity.startTime ? ` · ${activity.startTime}` : ''}`))
    const selector = assignmentSelect(activity.ddtFacilitator)
    const save = adminButton(activity.ddtFacilitator ? 'Actualizar' : 'Asignar', async () => {
      const activities = clone(row.activities); activities[index] = { ...activities[index], ddtFacilitator: selector.value }
      save.disabled = true
      const assigned = selector.value ? `Asignación guardada: ${selector.value}.` : 'Asignación retirada.'
      const saved = await saveAdminRow(row, { activities }, assigned)
      if (saved) renderAssignments(); else save.disabled = false
    }, 'button secondary')
    const controls = document.createElement('div'); controls.className = 'assignment-controls'
    controls.append(label('Facilitador/a DDT', selector), save)
    card.append(heading, controls); return card
  }
  function openAssignmentDialog() { renderAssignments(); $('assignmentDialog').showModal() }
  function openCancellation(sourcePlan, item, mode) {
    if (mode === 'delegate' && !sourcePlan.remoteId) { toast('Enviá primero el plan para registrar la cancelación en línea.'); return }
    pendingCancel = { rowId: sourcePlan.id || sourcePlan.remoteId, itemId: item.id, mode }
    $('cancelActivityTitle').textContent = item.topic || 'Capacitación sin tema'
    $('cancelActivityContext').textContent = `${sourcePlan.delegation} · ${item.date || 'Sin fecha'}. La información original se conservará en el historial.`
    $('cancelReason').value = ''; $('cancelError').textContent = ''
    $('activityCancelDialog').showModal()
    $('cancelReason').focus()
  }
  function adminEmailFromToken(token) {
    try { return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).email || '' } catch (_) { return '' }
  }
  async function confirmActivityCancellation() {
    const reason = $('cancelReason').value.trim()
    if (!reason) { $('cancelError').textContent = 'Escribí el motivo de cancelación para continuar.'; $('cancelReason').focus(); return }
    if (!pendingCancel) return
    const intent = pendingCancel; const cancelledAt = now()
    const cancellation = { status: 'CANCELADA', cancellationReason: reason, cancelledAt, cancelledByRole: intent.mode === 'admin' ? 'ADMINISTRADOR' : 'DELEGACIÓN' }
    if (intent.mode === 'admin') {
      const session = getAdminSession(); const row = adminRows.find(candidate => candidate.id === intent.rowId)
      if (!session || !row) { $('cancelError').textContent = 'La sesión expiró o el plan ya no está cargado. Actualizá e intentá nuevamente.'; return }
      cancellation.cancelledBy = adminEmailFromToken(session.accessToken) || CONFIG.adminEmail || 'Administrador DDT'
      const target = (row.activities || []).find(item => item.id === intent.itemId)
      if (!target) { $('cancelError').textContent = 'La capacitación ya no está en el plan. Actualizá la vista.'; return }
      if (isCancelled(target)) { $('cancelError').textContent = 'Esta capacitación ya está cancelada.'; return }
      const activities = clone(row.activities); Object.assign(activities.find(item => item.id === intent.itemId), cancellation)
      const saved = await saveAdminRow(row, { activities }, 'Capacitación cancelada y motivo guardado en Supabase.')
      if (!saved) return
    } else {
      const current = plan()
      if (!current.remoteId || current.remoteId !== intent.rowId) { $('cancelError').textContent = 'No coincide el plan territorial actual. Recargá la página e intentá nuevamente.'; return }
      cancellation.cancelledBy = current.registrantName || `Delegación ${current.delegation}`
      try {
        const latest = await api(`/rest/v1/${TABLE}?id=eq.${encodeURIComponent(current.remoteId)}&select=*`, {}, '', current.editToken)
        if (!latest?.length) throw new Error('El plan no se encontró o el acceso de esta delegación no está disponible.')
        const latestRow = latest[0]; const activities = activitiesFromRemote(latestRow); const target = activities.find(item => item.id === intent.itemId)
        if (!target) throw new Error('La capacitación ya no está en el plan. Actualizá la página.')
        if (isCancelled(target)) throw new Error('Esta capacitación ya fue cancelada.')
        Object.assign(target, cancellation)
        const saved = await api(`/rest/v1/${TABLE}?id=eq.${encodeURIComponent(current.remoteId)}&updated_at=eq.${encodeURIComponent(latestRow.updated_at)}&select=*`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ activities }) }, '', current.editToken)
        if (!saved?.length) throw new Error('El plan cambió mientras se confirmaba la cancelación. Actualizá y volvé a intentarlo.')
        mergePlanFromRemote(current, saved[0]); renderPlan()
      } catch (error) { $('cancelError').textContent = `No se guardó la cancelación: ${error.message}`; return }
    }
    $('activityCancelDialog').close(); pendingCancel = null
    renderCancelledReport()
  }
  function cancellationRows() {
    return adminRows.flatMap(row => (row.activities || []).filter(isCancelled).map(item => ({ ...item, delegation: row.delegation })))
  }
  function filteredCancellationRows() {
    const month = $('cancelledMonth').value; const delegation = $('cancelledDelegation').value
    return cancellationRows().filter(item => (!month || String(item.date || '').startsWith(month)) && (!delegation || item.delegation === delegation)).sort((a,b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.delegation || '').localeCompare(String(b.delegation || '')) || String(a.startTime || '').localeCompare(String(b.startTime || '')))
  }
  function renderCancelledReport() {
    if (!$('cancelledList')) return
    const rows = filteredCancellationRows(); const delegations = new Set(rows.map(item => item.delegation))
    const projected = rows.reduce((sum, item) => sum + (Number(item.projectedParticipants) || 0), 0)
    $('cancelledSummary').textContent = `${rows.length} cancelaciones · ${delegations.size} delegaciones · ${projected.toLocaleString('es-NI')} participantes proyectados afectados.`
    const root = $('cancelledList'); root.replaceChildren()
    if (!rows.length) { root.append(text('div', 'No se registran capacitaciones canceladas para el período seleccionado.', 'cancelled-empty')); return }
    rows.forEach((item, index) => {
      const card = document.createElement('article'); card.className = 'cancelled-row'
      card.append(text('h3', `${index + 1}. ${item.delegation} · ${item.topic || 'Capacitación sin tema'}`))
      ;[[`Fecha programada: ${item.date || 'Sin fecha'}`, `Municipio: ${item.municipality || '—'}`, `Lugar: ${item.location || '—'}`, `Proyección: ${Number(item.projectedParticipants) || 0}`, `Cancelada: ${formatDateTime(item.cancelledAt)}`, `Responsable: ${item.cancelledBy || item.cancelledByRole || 'No indicado'}`].join(' · '), `Motivo: ${item.cancellationReason || 'No indicado'}`].forEach(value => card.append(text('p', value)))
      root.append(card)
    })
  }
  function buildAdminEditor(row, card, item = null, index = -1, openButton = null) {
    const editor = document.createElement('div'); editor.className = 'admin-editor'
    const draft = item ? clone(item) : { ...blankActivity(), draft: false }
    const grid = document.createElement('div'); grid.className = 'activity-grid'
    ADMIN_FIELDS.forEach(([key, title, kind, choices]) => {
      let input
      if (kind === 'select') { input = selectControl(choices, draft[key]); if (draft[key] && !choices.includes(draft[key])) input.add(new Option(draft[key], draft[key])) }
      else if (kind === 'textarea') { input = document.createElement('textarea'); input.value = draft[key] || '' }
      else { input = inputControl(draft[key], kind); if (key === 'date') { input.min = '2026-11-01'; input.max = '2026-11-30' }; if (kind === 'number') input.min = '0' }
      input.oninput = () => { draft[key] = kind === 'number' ? Number(input.value) : input.value }
      grid.append(label(title, input, '', key === 'observations' ? 'full' : ['topic', 'location', 'participatingInstitutions', 'additionalDates'].includes(key) ? 'wide' : ''))
    })
    const buttons = document.createElement('div'); buttons.className = 'admin-toolbar'
    const saveLabel = item ? 'Guardar cambios' : 'Agregar capacitación al plan'
    buttons.append(adminButton(saveLabel, async () => {
      const required = ['activityType','topic','date','startTime','endTime','municipality','location','modality','trainingProvider','participatingInstitutions','responsible']
      if (required.some(key => !String(draft[key] || '').trim()) || !String(draft.date || '').startsWith('2026-11-') || Number(draft.projectedParticipants) <= 0 || (draft.trainingProvider === 'INTUR CENTRAL' && !String(draft.ddtFacilitator || '').trim())) { toast('Completá todos los campos obligatorios; la fecha debe ser de noviembre de 2026.'); return }
      const activities = clone(row.activities || [])
      if (item) activities[index] = draft
      else {
        draft.id = makeId(); draft.draft = false; draft.status = 'PROGRAMADA'; draft.addedByAdmin = true; draft.addedAt = now()
        const session = getAdminSession(); draft.addedBy = session ? adminEmailFromToken(session.accessToken) || CONFIG.adminEmail || 'Administrador DDT' : 'Administrador DDT'
        activities.push(draft)
      }
      const saved = await saveAdminRow(row, { activities }, item ? 'Capacitación actualizada en Supabase.' : `Capacitación agregada al plan de ${row.delegation} en Supabase.`)
      if (saved) renderAdmin(row.id)
    }, 'button secondary'), adminButton('Cancelar', () => { editor.remove(); if (openButton) openButton.disabled = false }))
    editor.append(grid, buttons); card.append(editor)
    if (openButton) openButton.disabled = true
  }
  function renderAdmin(openId = null) {
    const delegationFilter = $('adminDelegationFilter').value, statusFilter = $('adminStatusFilter').value, query = $('adminSearch').value.trim().toLocaleLowerCase('es')
    const filtered = adminRows.filter(row => (!delegationFilter || row.delegation === delegationFilter) && (!statusFilter || row.status === statusFilter) && (!query || JSON.stringify(row).toLocaleLowerCase('es').includes(query)))
    const totalActivities = adminRows.reduce((sum, row) => sum + activeActivities(row.activities).length, 0)
    const totalCancelled = adminRows.reduce((sum, row) => sum + cancelledActivities(row.activities).length, 0)
    const totalParticipants = adminRows.reduce((sum, row) => sum + activeActivities(row.activities).reduce((subtotal, item) => subtotal + (Number(item.projectedParticipants) || 0), 0), 0)
    $('adminDelegations').textContent = `${new Set(adminRows.map(row => row.delegation)).size} / 17`; $('adminActivities').textContent = totalActivities; $('adminCancelled').textContent = totalCancelled; $('adminParticipants').textContent = totalParticipants.toLocaleString('es-NI'); $('adminSubmitted').textContent = adminRows.filter(row => row.status === 'ENVIADO').length
    $('adminDownloadComplete').disabled = !adminRows.length
    $('adminDownloadExcelComplete').disabled = !adminRows.some(row => row.status === 'ENVIADO' && (row.activities || []).some(activity => !activity.draft))
    $('adminDownloadCentral').disabled = adminPeriod !== '2026-11' || !adminRows.some(row => row.status === 'ENVIADO' && (row.activities || []).some(activity => !activity.draft))
    const root = $('adminList'); const expandedIds = new Set([...root.querySelectorAll('details[open]')].map(el => el.dataset.rowId)); root.replaceChildren()
    if (!filtered.length) { root.append(text('div', 'No hay registros para los filtros seleccionados.', 'admin-empty')); return }
    filtered.forEach(row => {
      const details = document.createElement('details'); details.className = 'admin-card'; details.dataset.rowId = row.id; details.open = row.id === openId || expandedIds.has(row.id)
      const summary = document.createElement('summary'); const count = activeActivities(row.activities).length; const cancelled = cancelledActivities(row.activities).length; const projected = activeActivities(row.activities).reduce((sum, item) => sum + (Number(item.projectedParticipants) || 0), 0)
      const identity = document.createElement('div'); identity.append(text('strong', row.delegation), text('small', row.region))
      const contact = document.createElement('div'); contact.append(text('strong', row.registrant_name), text('small', row.registrant_role || 'Cargo no indicado'))
      const totals = document.createElement('div'); totals.append(text('strong', `${count} vigentes`), text('small', `${projected} participantes${cancelled ? ` · ${cancelled} canceladas` : ''}`))
      const state = text('span', row.status === 'ENVIADO' ? 'Enviado' : 'Borrador', `admin-state${row.status === 'ENVIADO' ? ' sent' : ''}`)
      summary.append(identity, contact, totals, state)
      const body = document.createElement('div'); body.className = 'admin-detail'
      const contactGrid = document.createElement('div'); contactGrid.className = 'admin-contact'
      ;[['Registró', row.registrant_name], ['Cargo', row.registrant_role], ['Correo', row.registrant_email], ['Teléfono', row.registrant_phone], ['Última actualización', formatDateTime(row.updated_at)], ['Estado', row.status]].forEach(([name, value]) => contactGrid.append(adminField(name, value)))
      body.append(contactGrid)
      const statusRow = document.createElement('div'); statusRow.className = 'admin-toolbar'
      const select = selectControl(['BORRADOR', 'ENVIADO'], row.status)
      statusRow.append(label('Cambiar estado del plan', select), adminButton('Guardar estado', async () => { if (select.value !== row.status && confirm(`¿Cambiar el estado de ${row.delegation} a ${select.value}?`)) await saveAdminRow(row, { status: select.value }, 'Estado actualizado.'); else if (select.value === row.status) toast('El estado no cambió.') }, 'button secondary'), adminButton('＋ Agregar capacitación', () => buildAdminEditor(row, body), 'button secondary'))
      if (row.period && row.status === 'ENVIADO') {
        const permissionPanel = document.createElement('div'); permissionPanel.className = 'admin-edit-permission'
        const permissionCopy = document.createElement('div'); permissionCopy.className = 'admin-edit-permission-copy'
        permissionCopy.append(text('strong', 'Edición del plan enviado'), text('small', `${displayDelegationName(row.delegation)} · ${periodLabel(String(row.period).slice(0, 7))}`))
        const permissionStatus = text('span', 'Consultando permiso…', 'admin-edit-permission-status')
        permissionStatus.setAttribute('role', 'status'); permissionStatus.setAttribute('aria-live', 'polite')
        permissionPanel.append(permissionCopy, permissionStatus)
        body.append(statusRow, permissionPanel)
        api(`/rest/v1/sat_plan_edit_permissions?period=eq.${row.period}&delegation=eq.${encodeURIComponent(row.delegation)}&select=enabled`, {}, getAdminSession()?.accessToken || '').then(rows => {
          let enabled = rows[0]?.enabled === true
          permissionStatus.textContent = enabled ? 'Edición permitida' : 'Solo consulta'
          permissionStatus.classList.toggle('is-enabled', enabled)
          const permissionButton = adminButton(enabled ? 'Quitar permiso de edición' : 'Permitir editar a la delegación', async () => {
            const next = !enabled
            const month = periodLabel(String(row.period).slice(0, 7))
            const question = next
              ? `¿Permitir que ${displayDelegationName(row.delegation)} edite el plan enviado de ${month}?`
              : `¿Quitar el permiso de edición de ${displayDelegationName(row.delegation)} para ${month}?`
            if (!confirm(question)) return
            const session = getAdminSession()
            if (!session) { toast('La sesión administrativa expiró. Iniciá sesión nuevamente.'); return }
            permissionButton.disabled = true
            try {
              await api('/rest/v1/sat_plan_edit_permissions?on_conflict=period,delegation', {
                method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
                body: JSON.stringify({ period: row.period, delegation: row.delegation, enabled: next })
              }, session.accessToken)
              enabled = next
              permissionStatus.textContent = enabled ? 'Edición permitida' : 'Solo consulta'
              permissionStatus.classList.toggle('is-enabled', enabled)
              permissionButton.textContent = enabled ? 'Quitar permiso de edición' : 'Permitir editar a la delegación'
              toast(enabled
                ? `${displayDelegationName(row.delegation)} puede editar su plan de ${month}. Pedile que actualice la página para ver los controles.`
                : `Se quitó el permiso de edición de ${displayDelegationName(row.delegation)} para ${month}.`)
            } catch (error) { toast('No se pudo actualizar el permiso: ' + error.message) }
            finally { permissionButton.disabled = false }
          }, 'button secondary')
          permissionPanel.append(permissionButton)
        }).catch(error => { permissionStatus.textContent = 'No se pudo consultar el permiso'; toast(error.message) })
      } else body.append(statusRow)
      if (row.status === 'ENVIADO') {
        const downloads = document.createElement('div'); downloads.className = 'admin-downloads'
        downloads.append(text('p', `Descargas disponibles para el plan enviado de ${row.delegation}.`))
        downloads.append(adminButton('▣ Descargar plan en Word', () => exportPlan('word', { id: row.id, period: row.period, legacy: row.legacy, delegation: row.delegation, activities: row.activities || [] }, null), 'button word'), adminButton('▦ Descargar plan en Excel', () => exportPlan('excel', row, null), 'button excel'), adminButton('▧ Generar imagen PNG', () => exportPlan('image', { id: row.id, period: row.period, legacy: row.legacy, delegation: row.delegation, activities: row.activities || [] }, null), 'button image'))
        body.append(downloads)
      }
      ;(row.activities || []).forEach((item, index) => {
        const cancelledItem = isCancelled(item)
        const card = document.createElement('details'); card.className = `admin-activity-card${cancelledItem ? ' is-cancelled' : ''}`
        const heading = document.createElement('summary'); heading.className = 'admin-activity-heading'
        const titleWrap = document.createElement('span'); titleWrap.className = 'activity-status'; titleWrap.append(text('strong', `${index + 1}. ${item.topic || 'Capacitación sin tema'}`)); if (cancelledItem) titleWrap.append(text('span', 'CANCELADA', 'cancelled-badge')); heading.append(titleWrap)
        const fieldGrid = document.createElement('div'); fieldGrid.className = 'admin-all-fields'
        ADMIN_FIELDS.forEach(([key, title]) => fieldGrid.append(adminField(title, item[key])))
        if (cancelledItem) {
          fieldGrid.append(adminField('Fecha de cancelación', formatDateTime(item.cancelledAt)), adminField('Cancelada por', item.cancelledBy || item.cancelledByRole))
          const reason = text('div', `Motivo: ${item.cancellationReason || 'No indicado'}`, 'cancelled-reason'); fieldGrid.append(reason)
        }
        const actions = document.createElement('div'); actions.className = 'admin-toolbar'
        if (!cancelledItem) actions.append(adminButton('Editar capacitación', event => buildAdminEditor(row, card, item, index, event.currentTarget), 'button secondary'), adminButton('Cancelar capacitación', () => openCancellation(row, item, 'admin'), 'button admin-danger'))
        card.append(heading, fieldGrid, actions); body.append(card)
      })
      details.append(summary, body); root.append(details)
    })
  }
  function bindEvents() {
    const menuToggle = $('menuToggle'), menuScrim = $('menuScrim')
    const closeMenu = () => {
      document.body.classList.remove('nav-open')
      menuToggle.setAttribute('aria-expanded', 'false')
      menuToggle.setAttribute('aria-label', 'Abrir menú')
      menuScrim.hidden = true
    }
    menuToggle.onclick = () => {
      const open = !document.body.classList.contains('nav-open')
      document.body.classList.toggle('nav-open', open)
      menuToggle.setAttribute('aria-expanded', String(open))
      menuToggle.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú')
      menuScrim.hidden = !open
    }
    menuScrim.onclick = closeMenu
    document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu() })
    window.addEventListener('resize', () => { if (window.innerWidth > 760) closeMenu() })
    $('helpClose').onclick = () => $('helpDialog').close()
    document.querySelectorAll('.sidebar nav a').forEach(link => {
      link.addEventListener('click', event => {
        if (link.getAttribute('href') === '#help') {
          event.preventDefault()
          $('helpDialog').showModal()
        } else if (link.id !== 'satAccountsLink' && document.querySelector(link.getAttribute('href'))?.closest('[hidden]')) {
          event.preventDefault()
          const destination = !$('satDelegationAccess').hidden ? $('satDelegationAccess') : $('adminView')
          destination.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
        document.querySelectorAll('.sidebar nav a').forEach(item => { item.classList.remove('active'); item.removeAttribute('aria-current') })
        link.classList.add('active')
        link.setAttribute('aria-current', 'page')
        closeMenu()
      })
    })
    $('addFirst').onclick = addActivity
    $('addActivityTop').onclick = addActivity
    $('stepNav1').onclick = () => showDelegationStep(1)
    $('stepNav2').onclick = () => showDelegationStep(2)
    $('step1Continue').onclick = () => {
      const issues = registrantStepIssues()
      if (issues.length) { showIssuesInStep(issues, 1); return }
      showDelegationStep(2)
    }
    $('step2Back').onclick = () => showDelegationStep(1)
    $('saveDraftStep1').onclick = saveDraftOnDevice
    $('saveDraftStep2').onclick = saveDraftOnDevice
    $('submitPlan').onclick = requestPlanSubmission
    $('confirmSubmitPlan').onclick = async () => {
      const button = $('confirmSubmitPlan')
      button.disabled = true
      try {
        if (await savePlan('ENVIADO')) $('submitConfirmDialog').close()
      } finally { button.disabled = false }
    }
    $('downloadWord').onclick = event => exportPlan('word', plan(), event.currentTarget)
    $('downloadExcel').onclick = event => exportPlan('excel', plan(), event.currentTarget)
    $('adminAccess').onclick = async () => { const session = getAdminSession(); if (session) await showAdmin(session.accessToken); else $('adminDialog').showModal() }
    $('adminLoginForm').onsubmit = adminLogin
    $('assignDdtStaff').onclick = openAssignmentDialog
    $('adminPlanDdt').onclick = openPlanDdt
    $('ddtBack').onclick = () => { $('planDdtView').hidden = true; $('adminDashboard').hidden = false }
    $('downloadDdtWord').onclick = event => downloadDdtPlan(event.currentTarget)
    $('adminLogout').onclick = () => { $('satPasswordRevealDialog').close(); sessionStorage.removeItem(ADMIN_SESSION_KEY); $('adminView').hidden = true; $('delegateView').hidden = true; $('satAccountsLink').hidden = true; $('satAccounts').hidden = true; $('satAccountsMessage').textContent = ''; $('satDelegationAccess').hidden = false; $('headerDelegationName').textContent = 'Sin sesión'; $('selectedPeriodLabel').hidden = false; toast('Sesión administrativa cerrada.') }
    setupDelegationPeriodPicker()
    setupAdminPeriodPicker()
    setupDelegationAccess()
    $('adminDownloadComplete').onclick = event => exportPlan('wordComplete', adminRows, event.currentTarget)
    $('adminDownloadExcelComplete').onclick = event => exportPlan('excelComplete', adminRows, event.currentTarget)
    $('adminDownloadCentral').onclick = event => exportForSatCentral(event.currentTarget)
    $('adminCancelledOpen').onclick = () => { renderCancelledReport(); $('cancelledDialog').showModal() }
    $('cancelledClose').onclick = () => $('cancelledDialog').close()
    $('cancelledMonth').onchange = renderCancelledReport; $('cancelledDelegation').onchange = renderCancelledReport
    setOptions($('cancelledDelegation'), ['Todas las delegaciones', ...DELEGATIONS], 'Todas las delegaciones'); $('cancelledDelegation').options[0].value = ''
    $('cancelledDownload').onclick = async event => {
      const button = event.currentTarget; const originalLabel = button.textContent
      try { button.disabled = true; button.textContent = 'Generando informe…'; await window.SATPlanExports.cancellationReport({ rows: filteredCancellationRows(), month: $('cancelledMonth').value }); toast('Informe de cancelaciones descargado en Word.') }
      catch (error) { toast(`No se pudo generar el informe: ${error.message}`) }
      finally { button.disabled = false; button.textContent = originalLabel }
    }
    $('confirmCancelActivity').onclick = confirmActivityCancellation
    $('cancelReason').oninput = () => { $('cancelError').textContent = '' }
    setOptions($('adminDelegationFilter'), ['Todas', ...DELEGATIONS], 'Todas'); $('adminDelegationFilter').options[0].value = ''
    $('adminDelegationFilter').onchange = renderAdmin; $('adminStatusFilter').onchange = renderAdmin; $('adminSearch').oninput = renderAdmin
    $('adminRefresh').onclick = async () => { const session = getAdminSession(); if (!session) return; await showAdmin(session.accessToken); renderCancelledReport(); toast('Informe actualizado.') }
  }
  connectionBanner(); setupSelectors(); bindEvents(); ensureSelectedPlan(); renderPlan(); refreshSelectedPlanFromRemote().catch(() => {})
})()
