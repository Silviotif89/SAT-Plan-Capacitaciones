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
  const PROVIDERS = ['INTUR CENTRAL', 'INATEC', 'MIFIC', 'MINSA', 'SETEC', 'BOMBEROS', 'POLICÍA', 'Delegación Departamental', 'Otra institución']
  const ACTIVITY_TYPES = ['Capacitación', 'Taller', 'Curso', 'Seminario', 'Charla', 'Asistencia técnica', 'Otra']
  const MODALITIES = ['Presencial', 'Virtual', 'Híbrida']
  const DDT_FACILITATORS = ['Tania Rodríguez', 'Raúl Zambrana', 'Silvio Rodriguez', 'Karla Aburto', 'Andrea Guatemala', 'Patricia Hernández', 'Maria Guadalupe Munguia']
  const configured = Boolean(CONFIG.supabaseUrl && CONFIG.publishableKey)
  const $ = id => document.getElementById(id)
  const clone = value => JSON.parse(JSON.stringify(value))
  const makeId = () => crypto.randomUUID ? crypto.randomUUID() : `sat-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const now = () => new Date().toISOString()
  const formatDateTime = value => value ? new Intl.DateTimeFormat('es-NI', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : 'Pendiente'
  const blankActivity = () => ({ id: makeId(), draft: true, activityType: 'Capacitación', topic: '', date: '2026-11-02', additionalDates: '', startTime: '08:00', endTime: '12:00', municipality: '', location: '', modality: 'Presencial', trainingProvider: '', ddtFacilitator: '', participatingInstitutions: '', responsible: '', projectedParticipants: 25, observations: '' })
  const blankPlan = delegation => ({ remoteId: '', editToken: makeId(), region: regionFor(delegation), delegation, registrantName: '', registrantRole: '', registrantEmail: '', registrantPhone: '', status: 'BORRADOR', activities: [], createdAt: now(), updatedAt: now() })

  let store = loadStore()
  let adminRows = []
  let savingPlan = false
  let editingActivityId = null
  let editingSnapshot = null

  function regionFor(delegation) { return Object.keys(REGIONS).find(region => REGIONS[region].includes(delegation)) || 'Pacífico' }
  function normalizeActivityProvider(activity) {
    if (activity?.trainingProvider === 'INTUR') activity.trainingProvider = 'INTUR CENTRAL'
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
    if (!store.plans[name]) store.plans[name] = blankPlan(name)
    return store.plans[name]
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
    $('saveMessage').textContent = 'Los cambios están en esta pantalla. Presioná “Guardar actividad” para conservar el borrador.'
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
  function connectionBanner() {
    const box = $('connection'); box.classList.add('visible', configured ? 'ok' : 'warning')
    box.textContent = configured ? '● Conexión central activa. Guardar actividad conserva el borrador y Enviar plan lo registra para la DDT.' : '⚠ Configuración pendiente: el formulario conserva borradores locales, pero todavía no puede reunir información de varias delegaciones. Completá config.js y Supabase antes de publicarlo.'
  }
  function setupSelectors() {
    setOptions($('region'), Object.keys(REGIONS), regionFor(store.selectedDelegation))
    setOptions($('delegation'), REGIONS[$('region').value], store.selectedDelegation)
    $('region').addEventListener('change', () => {
      editingActivityId = null; editingSnapshot = null
      const first = REGIONS[$('region').value][0]
      store.selectedDelegation = first; setOptions($('delegation'), REGIONS[$('region').value], first); ensureSelectedPlan(); renderPlan()
    })
    $('delegation').addEventListener('change', () => { editingActivityId = null; editingSnapshot = null; store.selectedDelegation = $('delegation').value; ensureSelectedPlan(); renderPlan() })
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
    const savedActivities = current.activities.filter(item => !item.draft)
    $('activityCount').textContent = savedActivities.length
    $('participantCount').textContent = savedActivities.reduce((sum, item) => sum + (Number(item.projectedParticipants) || 0), 0).toLocaleString('es-NI')
    $('delegationMetric').textContent = current.delegation
    $('headerDelegationName').textContent = current.delegation
    $('lastSaved').textContent = formatDateTime(current.updatedAt)
    $('activitiesHeading').textContent = `Capacitaciones de ${current.delegation}`
    $('planStatus').textContent = current.status === 'ENVIADO' ? 'Plan enviado' : 'Borrador'
    $('planStatus').classList.toggle('sent', current.status === 'ENVIADO')
    $('downloadPanel').hidden = current.status !== 'ENVIADO' || !current.remoteId
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
      const row = document.createElement('tr')
      const values = [String(index + 1), item.topic || 'Sin tema', formatActivityDate(item.date), `${formatActivityTime(item.startTime)} – ${formatActivityTime(item.endTime)}`, item.municipality || '—', item.location || '—', item.trainingProvider || '—', Number(item.projectedParticipants || 0).toLocaleString('es-NI'), 'Registrada']
      values.forEach((value, cellIndex) => { const cell = document.createElement('td'); cell.dataset.label = headers[cellIndex]; if (cellIndex === 8) { const badge = text('span', value, 'saved-pill'); cell.append(badge) } else cell.textContent = value; row.append(cell) })
      const actions = document.createElement('td'); actions.dataset.label = 'Acciones'; actions.className = 'table-actions'
      const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'table-action edit'; edit.append(icon('M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z')); edit.title = `Editar ${item.topic || 'capacitación'}`; edit.setAttribute('aria-label', edit.title)
      edit.onclick = () => { editingActivityId = item.id; editingSnapshot = clone(item); renderActivities() }
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'table-action delete'; remove.append(icon('M3 6h18 M8 6V4h8v2 M19 6l-1 14H6L5 6 M10 11v5 M14 11v5')); remove.title = `Eliminar ${item.topic || 'capacitación'}`; remove.setAttribute('aria-label', remove.title)
      remove.onclick = () => { if (confirm('¿Eliminar esta capacitación del plan?')) { const itemIndex = current.activities.findIndex(activity => activity.id === item.id); if (itemIndex >= 0) current.activities.splice(itemIndex, 1); saveLocalAndRender(); renderActivities() } }
      actions.append(edit, remove); row.append(actions); tbody.append(row)
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
      const article = document.createElement('article'); article.className = 'activity-card'; article.dataset.activityId = item.id
      const head = document.createElement('div'); head.className = 'activity-head'
      const title = document.createElement('strong'); title.textContent = `${editingActivityId === item.id ? 'Editar capacitación' : 'Nueva capacitación'} · ${index + 1}`
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Eliminar'
      remove.onclick = () => { if (confirm('¿Eliminar esta capacitación del plan?')) { current.activities.splice(index, 1); if (editingActivityId === item.id) { editingActivityId = null; editingSnapshot = null } saveLocalAndRender(); renderActivities() } }
      head.append(title, remove)
      const grid = document.createElement('div'); grid.className = 'activity-grid'
      const activityType = bindActivityControl(selectControl(ACTIVITY_TYPES, item.activityType), item, 'activityType')
      const topic = bindActivityControl(inputControl(item.topic), item, 'topic'); topic.placeholder = 'Ej. Taller de elaboración de cócteles y aperitivos'
      const date = bindActivityControl(inputControl(item.date, 'date'), item, 'date'); date.min = '2026-11-01'; date.max = '2026-11-30'
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
      const actions = document.createElement('div'); actions.className = 'card-save'
      const save = document.createElement('button'); save.type = 'button'; save.className = 'button secondary'; save.textContent = editingActivityId === item.id ? 'Guardar cambios' : 'Guardar actividad'; save.dataset.saveActivity = item.id; save.onclick = () => saveActivity(item)
      actions.append(save)
      if (editingActivityId === item.id) {
        const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'button ghost'; cancel.textContent = 'Cancelar'; cancel.onclick = () => { const originalIndex = current.activities.findIndex(activity => activity.id === item.id); if (originalIndex >= 0 && editingSnapshot) current.activities[originalIndex] = editingSnapshot; editingActivityId = null; editingSnapshot = null; persistLocal(); renderActivities(); renderSummary() }
        actions.append(cancel)
      }
      article.append(head, grid, actions); root.append(article)
    })
  }
  function addActivity() { if (plan().activities.some(item => item.draft) || editingActivityId) return; plan().activities.push(blankActivity()); saveLocalAndRender(); renderActivities(); document.querySelector('.activity-card:last-child')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
  async function saveActivity(item) {
    item.draft = false; if (editingActivityId === item.id) { editingActivityId = null; editingSnapshot = null } plan().status = 'BORRADOR'; plan().updatedAt = now(); persistLocal(); renderActivities(); renderSummary()
    $('saveMessage').textContent = 'Actividad guardada como borrador. Ya podés agregar otra actividad o continuar con el plan.'
    toast('Actividad guardada como borrador.')
    if (!validatePlan(false).length) await savePlan('BORRADOR')
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
    if (finalSubmission && !$('confirmReview').checked) addIssue('Confirmá que revisaste la información del plan.', () => $('confirmReview'))
    if (!current.registrantName.trim()) addIssue('Indicá el nombre de quien registra.', () => $('registrantName'))
    if (!current.registrantRole.trim()) addIssue('Indicá el cargo.', () => $('registrantRole'))
    if (!/^\S+@\S+\.\S+$/.test(current.registrantEmail)) addIssue('Ingresá un correo válido.', () => $('registrantEmail'))
    if (!current.registrantPhone.trim()) addIssue('Indicá el teléfono.', () => $('registrantPhone'))
    if (!current.activities.length) addIssue('Agregá al menos una capacitación.', () => $('addFirst'))
    current.activities.forEach((item, index) => {
      if (item.draft) addIssue(`Guardá la actividad ${index + 1} antes de enviar.`, () => document.querySelector(`[data-save-activity="${item.id}"]`))
      const required = ['activityType', 'topic', 'date', 'startTime', 'endTime', 'municipality', 'location', 'modality', 'trainingProvider', 'participatingInstitutions', 'responsible']
      required.forEach(key => { if (!String(item[key] || '').trim()) addIssue(`Completá este dato de la actividad ${index + 1}.`, () => activityControl(item.id, key), item.id) })
      if (item.date && !String(item.date).startsWith('2026-11-')) addIssue('La fecha debe corresponder a noviembre de 2026.', () => activityControl(item.id, 'date'), item.id)
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
    if (savingPlan) return
    const finalSubmission = status === 'ENVIADO'; const issues = validatePlan(finalSubmission)
    if (issues.length) { showValidationIssues(issues); toast('Completá los campos resaltados en rojo.'); return }
    if (!configured) { persistLocal(); toast('Borrador local guardado. Falta conectar Supabase para registrar la información en línea.'); return }
    const current = plan(); const payload = remotePayload(current, status)
    savingPlan = true; const submit = $('submitPlan'); const submitText = submit.textContent
    submit.disabled = true; submit.textContent = status === 'ENVIADO' ? 'Enviando plan…' : submitText
    try {
      let rows
      if (current.remoteId) rows = await api(`/rest/v1/${TABLE}?id=eq.${encodeURIComponent(current.remoteId)}&select=*`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(payload) }, '', current.editToken)
      else rows = await api(`/rest/v1/${TABLE}?select=*`, { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ ...payload, created_at: now() }) }, '', current.editToken)
      if (!rows?.length) throw new Error('No se confirmó el guardado. Verificá que el navegador conserve el acceso de edición.')
      current.remoteId = rows[0].id; current.status = status; current.updatedAt = rows[0].updated_at || now(); persistLocal(); clearValidationErrors(); renderSummary()
      $('saveMessage').textContent = status === 'ENVIADO' ? 'Plan enviado correctamente a la DDT.' : 'Borrador guardado en línea.'
      toast(status === 'ENVIADO' ? 'Plan enviado correctamente.' : 'Borrador guardado en línea.')
    } catch (error) {
      const message = error.status === 409 ? 'Esta delegación ya tiene un plan registrado desde otro navegador. Contactá a la DDT para recuperar el acceso.' : `No se pudo guardar: ${error.message}`
      $('saveMessage').textContent = message; toast(message)
    } finally { savingPlan = false; submit.disabled = false; submit.textContent = submitText }
  }
  async function loadPlanForExcel(sourcePlan) {
    if (!configured) throw new Error('No hay conexión con Supabase para consultar el plan actualizado.')
    const delegationAccess = Boolean(sourcePlan.remoteId && sourcePlan.editToken)
    const recordId = sourcePlan.remoteId || sourcePlan.id
    if (!recordId) throw new Error('El plan debe estar enviado a Supabase antes de descargarlo.')
    const adminSession = delegationAccess ? null : getAdminSession()
    if (!delegationAccess && !adminSession) throw new Error('La sesión administrativa expiró. Iniciá sesión nuevamente.')
    const rows = await api(`/rest/v1/${TABLE}?id=eq.${encodeURIComponent(recordId)}&select=*`, {}, adminSession?.accessToken || '', delegationAccess ? sourcePlan.editToken : '')
    if (!Array.isArray(rows) || rows.length !== 1) throw new Error('No se encontró el plan en Supabase con el acceso actual.')
    if (rows[0].status !== 'ENVIADO') throw new Error('El plan todavía no está enviado en Supabase.')
    // Cada delegación es un único registro; activities contiene el arreglo completo sin paginación de filas.
    return { id: rows[0].id, delegation: rows[0].delegation, status: rows[0].status, activities: rows[0].activities || [] }
  }
  async function exportPlan(format, sourcePlan, button) {
    const exporter = window.SATPlanExports?.[format]
    if (!exporter) { toast('No se pudo preparar la descarga. Actualizá la página e intentá nuevamente.'); return }
    const label = button?.textContent
    try {
      if (button) { button.disabled = true; button.textContent = 'Generando documento…' }
      const exportSource = format === 'excel' ? await loadPlanForExcel(sourcePlan) : sourcePlan
      await exporter(exportSource); toast(`Plan mensual en ${format === 'word' ? 'Word' : 'Excel'} generado.`)
    }
    catch (error) { toast(`No se pudo generar el documento: ${error.message}`) }
    finally { if (button) setTimeout(() => { button.disabled = false; button.textContent = label }, 350) }
  }
  function exportForSatCentral(button) {
    const plans = adminRows.filter(row => row.status === 'ENVIADO')
    const activities = plans.flatMap(row => (row.activities || []).filter(activity => !activity.draft).map(activity => ({
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
  async function showAdmin(token) {
    $('delegateView').hidden = true; $('adminView').hidden = false
    try { adminRows = await api(`/rest/v1/${TABLE}?select=*&order=updated_at.desc`, {}, token); adminRows.forEach(row => (row.activities || []).forEach(normalizeActivityProvider)); renderAdmin() }
    catch (error) { toast(`No se pudo abrir el informe: ${error.message}`); adminRows = []; renderAdmin() }
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
      const endpoint = `/rest/v1/${TABLE}?id=eq.${encodeURIComponent(row.id)}&updated_at=eq.${encodeURIComponent(row.updated_at)}&select=*`
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
    const assignments = adminRows.flatMap(row => (row.activities || []).map((activity, index) => ({ row, activity, index })).filter(({ activity }) => isCentralTraining(activity)))
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
  function renderAdmin(openId = null) {
    const delegationFilter = $('adminDelegationFilter').value, statusFilter = $('adminStatusFilter').value, query = $('adminSearch').value.trim().toLocaleLowerCase('es')
    const filtered = adminRows.filter(row => (!delegationFilter || row.delegation === delegationFilter) && (!statusFilter || row.status === statusFilter) && (!query || JSON.stringify(row).toLocaleLowerCase('es').includes(query)))
    const totalActivities = adminRows.reduce((sum, row) => sum + (row.activities?.length || 0), 0)
    const totalParticipants = adminRows.reduce((sum, row) => sum + (row.activities || []).reduce((subtotal, item) => subtotal + (Number(item.projectedParticipants) || 0), 0), 0)
    $('adminDelegations').textContent = `${new Set(adminRows.map(row => row.delegation)).size} / 17`; $('adminActivities').textContent = totalActivities; $('adminParticipants').textContent = totalParticipants.toLocaleString('es-NI'); $('adminSubmitted').textContent = adminRows.filter(row => row.status === 'ENVIADO').length
    $('adminDownloadComplete').disabled = !adminRows.length
    $('adminDownloadCentral').disabled = !adminRows.some(row => row.status === 'ENVIADO' && (row.activities || []).some(activity => !activity.draft))
    const root = $('adminList'); const expandedIds = new Set([...root.querySelectorAll('details[open]')].map(el => el.dataset.rowId)); root.replaceChildren()
    if (!filtered.length) { root.append(text('div', 'No hay registros para los filtros seleccionados.', 'admin-empty')); return }
    filtered.forEach(row => {
      const details = document.createElement('details'); details.className = 'admin-card'; details.dataset.rowId = row.id; details.open = row.id === openId || expandedIds.has(row.id)
      const summary = document.createElement('summary'); const count = row.activities?.length || 0; const projected = (row.activities || []).reduce((sum, item) => sum + (Number(item.projectedParticipants) || 0), 0)
      const identity = document.createElement('div'); identity.append(text('strong', row.delegation), text('small', row.region))
      const contact = document.createElement('div'); contact.append(text('strong', row.registrant_name), text('small', row.registrant_role || 'Cargo no indicado'))
      const totals = document.createElement('div'); totals.append(text('strong', `${count} actividades`), text('small', `${projected} participantes`))
      const state = text('span', row.status === 'ENVIADO' ? 'Enviado' : 'Borrador', `admin-state${row.status === 'ENVIADO' ? ' sent' : ''}`)
      summary.append(identity, contact, totals, state)
      const body = document.createElement('div'); body.className = 'admin-detail'
      const contactGrid = document.createElement('div'); contactGrid.className = 'admin-contact'
      ;[['Registró', row.registrant_name], ['Cargo', row.registrant_role], ['Correo', row.registrant_email], ['Teléfono', row.registrant_phone], ['Última actualización', formatDateTime(row.updated_at)], ['Estado', row.status]].forEach(([name, value]) => contactGrid.append(adminField(name, value)))
      body.append(contactGrid)
      const statusRow = document.createElement('div'); statusRow.className = 'admin-toolbar'
      const select = selectControl(['BORRADOR', 'ENVIADO'], row.status)
      statusRow.append(label('Cambiar estado del plan', select), adminButton('Guardar estado', async () => { if (select.value !== row.status && confirm(`¿Cambiar el estado de ${row.delegation} a ${select.value}?`)) await saveAdminRow(row, { status: select.value }, 'Estado actualizado.'); else if (select.value === row.status) toast('El estado no cambió.') }, 'button secondary'))
      body.append(statusRow)
      if (row.status === 'ENVIADO') {
        const downloads = document.createElement('div'); downloads.className = 'admin-downloads'
        downloads.append(text('p', `Descargas disponibles para el plan enviado de ${row.delegation}.`))
        downloads.append(adminButton('▣ Descargar plan en Word', () => exportPlan('word', { delegation: row.delegation, activities: row.activities || [] }, null), 'button word'), adminButton('▦ Descargar plan en Excel', () => exportPlan('excel', row, null), 'button excel'))
        body.append(downloads)
      }
      ;(row.activities || []).forEach((item, index) => {
        const card = document.createElement('details'); card.className = 'admin-activity-card'
        const heading = document.createElement('summary'); heading.className = 'admin-activity-heading'
        heading.append(text('strong', `${index + 1}. ${item.topic || 'Capacitación sin tema'}`))
        const fieldGrid = document.createElement('div'); fieldGrid.className = 'admin-all-fields'
        ADMIN_FIELDS.forEach(([key, title]) => fieldGrid.append(adminField(title, item[key])))
        const actions = document.createElement('div'); actions.className = 'admin-toolbar'
        const editButton = adminButton('Editar capacitación', () => {
          const editor = document.createElement('div'); editor.className = 'admin-editor'
          const draft = clone(item); const grid = document.createElement('div'); grid.className = 'activity-grid'
          ADMIN_FIELDS.forEach(([key, title, kind, choices]) => {
            let input
            if (kind === 'select') { input = selectControl(choices, draft[key]); if (draft[key] && !choices.includes(draft[key])) input.add(new Option(draft[key], draft[key])) }
            else if (kind === 'textarea') { input = document.createElement('textarea'); input.value = draft[key] || '' }
            else { input = inputControl(draft[key], kind); if (key === 'date') { input.min = '2026-11-01'; input.max = '2026-11-30' }; if (kind === 'number') input.min = '0' }
            input.oninput = () => { draft[key] = kind === 'number' ? Number(input.value) : input.value }
            grid.append(label(title, input, '', key === 'observations' ? 'full' : ['topic', 'location', 'participatingInstitutions', 'additionalDates'].includes(key) ? 'wide' : ''))
          })
          const buttons = document.createElement('div'); buttons.className = 'admin-toolbar'
          buttons.append(adminButton('Guardar cambios', async () => {
            const required = ['topic','date','startTime','endTime','municipality','location','trainingProvider','participatingInstitutions','responsible']
            if (required.some(key => !String(draft[key] || '').trim()) || !String(draft.date || '').startsWith('2026-11-') || Number(draft.projectedParticipants) <= 0 || (draft.trainingProvider === 'INTUR CENTRAL' && !String(draft.ddtFacilitator || '').trim())) { toast('Completá los campos obligatorios antes de guardar.'); return }
            const activities = clone(row.activities); activities[index] = draft
            await saveAdminRow(row, { activities }, 'Capacitación corregida en Supabase.')
          }, 'button secondary'), adminButton('Cancelar', () => { editor.remove(); editButton.disabled = false }))
          editor.append(grid, buttons); card.append(editor); editButton.disabled = true
        }, 'button secondary')
        const deleteButton = adminButton('Eliminar capacitación', async () => {
          if (!confirm(`¿Eliminar definitivamente la capacitación “${item.topic || 'Sin tema'}” de ${row.delegation}? Esta acción afecta el registro en línea.`)) return
          const activities = clone(row.activities); activities.splice(index, 1)
          await saveAdminRow(row, { activities }, 'Capacitación eliminada de Supabase.')
        }, 'button admin-danger')
        actions.append(editButton, deleteButton); card.append(heading, fieldGrid, actions); body.append(card)
      })
      details.append(summary, body); root.append(details)
    })
  }
  function bindEvents() {
    $('addFirst').onclick = addActivity
    $('addActivityTop').onclick = addActivity
    $('submitPlan').onclick = () => savePlan('ENVIADO')
    $('downloadWord').onclick = event => exportPlan('word', plan(), event.currentTarget)
    $('downloadExcel').onclick = event => exportPlan('excel', plan(), event.currentTarget)
    $('adminAccess').onclick = async () => { const session = getAdminSession(); if (session) await showAdmin(session.accessToken); else $('adminDialog').showModal() }
    $('adminLoginForm').onsubmit = adminLogin
    $('assignDdtStaff').onclick = openAssignmentDialog
    $('adminLogout').onclick = () => { sessionStorage.removeItem(ADMIN_SESSION_KEY); $('adminView').hidden = true; $('delegateView').hidden = false; toast('Sesión administrativa cerrada.') }
    $('adminDownloadComplete').onclick = event => exportPlan('wordComplete', adminRows, event.currentTarget)
    $('adminDownloadCentral').onclick = event => exportForSatCentral(event.currentTarget)
    setOptions($('adminDelegationFilter'), ['Todas', ...DELEGATIONS], 'Todas'); $('adminDelegationFilter').options[0].value = ''
    $('adminDelegationFilter').onchange = renderAdmin; $('adminStatusFilter').onchange = renderAdmin; $('adminSearch').oninput = renderAdmin
    $('adminRefresh').onclick = async () => { const session = getAdminSession(); if (!session) return; await showAdmin(session.accessToken); toast('Informe actualizado.') }
  }
  connectionBanner(); setupSelectors(); bindEvents(); ensureSelectedPlan(); renderPlan()
})()
