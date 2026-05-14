import DcpToggle from './DcpToggle.js'

export default {
  name: 'DeviceConfigPanel',
  components: { DcpToggle },
  props: {
    nodeId: { type: String, required: true },
  },
  emits: ['close'],

  data() {
    return {
      loading: true,
      saving: false,
      error: null,
      toast: null,
      activeTab: 'owner',
      original: null,
      current: null,
      showPrivateKey: false,
      showMapModal: false,
      mapInstance: null,
      mapMarker: null,
      mapPickLat: null,
      mapPickLng: null,
    }
  },

  computed: {
    tabs() {
      return [
        { id: 'owner',    label: 'Владелец' },
        { id: 'device',   label: 'Устройство' },
        { id: 'lora',     label: 'LoRa' },
        { id: 'position', label: 'Позиция' },
        { id: 'power',    label: 'Питание' },
        { id: 'network',  label: 'Сеть' },
        { id: 'display',  label: 'Экран' },
        { id: 'bluetooth',label: 'Bluetooth' },
        { id: 'security', label: 'Безопасность' },
        { id: 'mqtt',     label: 'MQTT' },
      ]
    },
    isDirty() {
      if (!this.original || !this.current) return false
      return JSON.stringify(this.original) !== JSON.stringify(this.current)
    },
  },

  async mounted() {
    await this.loadConfig()
  },

  beforeUnmount() {
    if (this.mapInstance) {
      this.mapInstance.remove()
      this.mapInstance = null
    }
  },

  methods: {
    async loadConfig() {
      this.loading = true
      this.error = null
      try {
        const res = await window.pywebview.api.get_device_config(this.nodeId)
        if (res.error) throw new Error(res.error)
        this.original = JSON.parse(JSON.stringify(res))
        this.current = JSON.parse(JSON.stringify(res))
      } catch (e) {
        this.error = e.message
      } finally {
        this.loading = false
      }
    },

    async save() {
      if (!this.isDirty || this.saving) return
      this.saving = true
      try {
        const delta = this.computeDelta()
        const res = await window.pywebview.api.set_device_config(this.nodeId, delta)
        if (res.error) throw new Error(res.error)
        this.original = JSON.parse(JSON.stringify(this.current))
        this.showToast('Настройки сохранены', 'success')
      } catch (e) {
        this.showToast('Ошибка: ' + e.message, 'error')
      } finally {
        this.saving = false
      }
    },

    computeDelta() {
      const delta = {}
      for (const key of Object.keys(this.current)) {
        if (JSON.stringify(this.original[key]) !== JSON.stringify(this.current[key])) {
          delta[key] = this.current[key]
        }
      }
      return delta
    },

    showToast(msg, type = 'success') {
      this.toast = { msg, type }
      setTimeout(() => { this.toast = null }, 3000)
    },

    get(section, field) {
      return this.current?.[section]?.[field] ?? ''
    },

    set(section, field, value) {
      if (!this.current[section]) this.current[section] = {}
      this.current[section][field] = value
    },

    bool(section, field) {
      return !!this.current?.[section]?.[field]
    },

    toggle(section, field, value) {
      if (!this.current[section]) this.current[section] = {}
      this.current[section][field] = value
    },

    num(section, field) {
      return this.current?.[section]?.[field] ?? 0
    },

    setNum(section, field, value) {
      if (!this.current[section]) this.current[section] = {}
      this.current[section][field] = parseInt(value) || 0
    },

    setFloat(section, field, value) {
      if (!this.current[section]) this.current[section] = {}
      this.current[section][field] = parseFloat(value) || 0
    },

    openMapModal() {
      this.mapPickLat = this.get('position', 'latitude_i') / 1e7 || 55.751
      this.mapPickLng = this.get('position', 'longitude_i') / 1e7 || 37.618
      this.showMapModal = true
      this.$nextTick(() => {
        if (this.mapInstance) {
          this.mapInstance.remove()
          this.mapInstance = null
        }
        const map = L.map('dcp-map').setView([this.mapPickLat, this.mapPickLng], 10)
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap',
        }).addTo(map)
        this.mapMarker = L.marker([this.mapPickLat, this.mapPickLng], { draggable: true }).addTo(map)
        this.mapMarker.on('dragend', (e) => {
          const ll = e.target.getLatLng()
          this.mapPickLat = ll.lat
          this.mapPickLng = ll.lng
        })
        map.on('click', (e) => {
          this.mapPickLat = e.latlng.lat
          this.mapPickLng = e.latlng.lng
          this.mapMarker.setLatLng(e.latlng)
        })
        this.mapInstance = map
      })
    },

    confirmMapPick() {
      if (!this.current.position) this.current.position = {}
      this.current.position.latitude_i = Math.round(this.mapPickLat * 1e7)
      this.current.position.longitude_i = Math.round(this.mapPickLng * 1e7)
      this.showMapModal = false
    },
  },

  template: `
    <div class="dcp-overlay" @click.self="$emit('close')">
      <div class="dcp-panel">
        <div class="dcp-header">
          <span class="dcp-title">Настройки устройства <span class="dcp-nodeid">{{ nodeId }}</span></span>
          <div class="dcp-header-actions">
            <button class="dcp-save-btn" :disabled="!isDirty || saving" @click="save">
              {{ saving ? 'Сохранение…' : 'Сохранить' }}
            </button>
            <button class="dcp-close-btn" @click="$emit('close')">✕</button>
          </div>
        </div>

        <div v-if="loading" class="dcp-loading">
          <div class="dcp-spinner"></div>
          <span>Загрузка настроек…</span>
        </div>

        <div v-else-if="error" class="dcp-error">
          <span>⚠ {{ error }}</span>
          <button class="dcp-retry-btn" @click="loadConfig">Повторить</button>
        </div>

        <template v-else>
          <div class="dcp-tabs">
            <button
              v-for="tab in tabs"
              :key="tab.id"
              class="dcp-tab"
              :class="{ active: activeTab === tab.id }"
              @click="activeTab = tab.id"
            >{{ tab.label }}</button>
          </div>

          <div class="dcp-body">

            <!-- Owner -->
            <template v-if="activeTab === 'owner'">
              <div class="dcp-section-title">Владелец устройства</div>
              <div class="dcp-field">
                <label>Длинное имя</label>
                <input type="text" maxlength="39"
                  :value="current.owner.long_name"
                  @input="current.owner.long_name = $event.target.value" />
              </div>
              <div class="dcp-field">
                <label>Короткое имя (до 4 символов)</label>
                <input type="text" maxlength="4"
                  :value="current.owner.short_name"
                  @input="current.owner.short_name = $event.target.value" />
              </div>
            </template>

            <!-- Device -->
            <template v-else-if="activeTab === 'device'">
              <div class="dcp-section-title">Устройство</div>
              <div class="dcp-field">
                <label>Роль</label>
                <select :value="get('device','role')" @change="set('device','role',$event.target.value)">
                  <option value="CLIENT">CLIENT — клиент (по умолчанию)</option>
                  <option value="CLIENT_MUTE">CLIENT_MUTE — не ретранслирует</option>
                  <option value="ROUTER">ROUTER — маршрутизатор</option>
                  <option value="TRACKER">TRACKER — трекер позиции</option>
                  <option value="SENSOR">SENSOR — датчик телеметрии</option>
                  <option value="TAK">TAK — ATAK клиент</option>
                  <option value="CLIENT_HIDDEN">CLIENT_HIDDEN — скрытый клиент</option>
                  <option value="LOST_AND_FOUND">LOST_AND_FOUND — поиск потерянных</option>
                  <option value="TAK_TRACKER">TAK_TRACKER — TAK трекер</option>
                  <option value="ROUTER_LATE">ROUTER_LATE — низкоприоритетный маршрутизатор</option>
                  <option value="CLIENT_BASE">CLIENT_BASE — базовая станция</option>
                </select>
              </div>
              <div class="dcp-field">
                <label>Режим ретрансляции</label>
                <select :value="get('device','rebroadcast_mode')" @change="set('device','rebroadcast_mode',$event.target.value)">
                  <option value="ALL">ALL — все пакеты</option>
                  <option value="ALL_SKIP_DECODING">ALL_SKIP_DECODING — без декодирования</option>
                  <option value="LOCAL_ONLY">LOCAL_ONLY — только свои</option>
                  <option value="KNOWN_ONLY">KNOWN_ONLY — только известные ноды</option>
                  <option value="NONE">NONE — без ретрансляции</option>
                  <option value="CORE_PORTNUMS_ONLY">CORE_PORTNUMS_ONLY — только стандартные порты</option>
                </select>
              </div>
              <div class="dcp-field">
                <label>Интервал рассылки NodeInfo (сек)</label>
                <input type="number" min="0" max="86400"
                  :value="num('device','node_info_broadcast_secs')"
                  @input="setNum('device','node_info_broadcast_secs', $event.target.value)" />
              </div>
              <div class="dcp-field">
                <label>Временная зона (POSIX, напр. MSK-3)</label>
                <input type="text" placeholder="MSK-3"
                  :value="get('device','tzdef')"
                  @input="set('device','tzdef', $event.target.value)" />
              </div>
              <div class="dcp-field">
                <label>Режим зуммера</label>
                <select :value="get('device','buzzer_mode')" @change="set('device','buzzer_mode',$event.target.value)">
                  <option value="ALL_ENABLED">ALL_ENABLED — все звуки</option>
                  <option value="DISABLED">DISABLED — выключен</option>
                  <option value="NOTIFICATIONS_ONLY">NOTIFICATIONS_ONLY — только уведомления</option>
                  <option value="SYSTEM_ONLY">SYSTEM_ONLY — только системные</option>
                  <option value="DIRECT_MSG_ONLY">DIRECT_MSG_ONLY — только личные сообщения</option>
                </select>
              </div>
              <div class="dcp-toggles">
                <DcpToggle label="Двойной тап как кнопка" :model-value="bool('device','double_tap_as_button_press')" @update:model-value="toggle('device','double_tap_as_button_press', $event)" />
                <DcpToggle label="Отключить тройной клик (сброс GPS)" :model-value="bool('device','disable_triple_click')" @update:model-value="toggle('device','disable_triple_click', $event)" />
                <DcpToggle label="Отключить мигание LED" :model-value="bool('device','led_heartbeat_disabled')" @update:model-value="toggle('device','led_heartbeat_disabled', $event)" />
              </div>
            </template>

            <!-- LoRa -->
            <template v-else-if="activeTab === 'lora'">
              <div class="dcp-section-title">Радио LoRa</div>
              <div class="dcp-field">
                <label>Регион</label>
                <select :value="get('lora','region')" @change="set('lora','region',$event.target.value)">
                  <option value="UNSET">UNSET — не задан</option>
                  <option value="US">US — США 915 МГц</option>
                  <option value="EU_433">EU_433 — Европа 433 МГц</option>
                  <option value="EU_868">EU_868 — Европа 868 МГц</option>
                  <option value="CN">CN — Китай 470 МГц</option>
                  <option value="JP">JP — Япония 920 МГц</option>
                  <option value="ANZ">ANZ — Австралия/НЗ 915 МГц</option>
                  <option value="KR">KR — Корея 920 МГц</option>
                  <option value="TW">TW — Тайвань 923 МГц</option>
                  <option value="RU">RU — Россия 868 МГц</option>
                  <option value="IN">IN — Индия 865 МГц</option>
                  <option value="NZ_865">NZ_865 — Новая Зеландия 865 МГц</option>
                  <option value="TH">TH — Таиланд 920 МГц</option>
                  <option value="LORA_24">LORA_24 — 2.4 ГГц</option>
                  <option value="UA_433">UA_433 — Украина 433 МГц</option>
                  <option value="UA_868">UA_868 — Украина 868 МГц</option>
                  <option value="MY_433">MY_433 — Малайзия 433 МГц</option>
                  <option value="MY_919">MY_919 — Малайзия 919 МГц</option>
                  <option value="SG_923">SG_923 — Сингапур 923 МГц</option>
                </select>
              </div>
              <div class="dcp-field">
                <label>Пресет модема</label>
                <select :value="get('lora','modem_preset')" @change="set('lora','modem_preset',$event.target.value)">
                  <option value="LONG_FAST">LONG_FAST — дальность/скорость (по умолчанию)</option>
                  <option value="LONG_SLOW">LONG_SLOW — дальность/медленно</option>
                  <option value="VERY_LONG_SLOW">VERY_LONG_SLOW — максимальная дальность</option>
                  <option value="MEDIUM_SLOW">MEDIUM_SLOW — средняя дальность/медленно</option>
                  <option value="MEDIUM_FAST">MEDIUM_FAST — средняя дальность/скорость</option>
                  <option value="SHORT_SLOW">SHORT_SLOW — короткая дальность/медленно</option>
                  <option value="SHORT_FAST">SHORT_FAST — короткая дальность/скорость</option>
                  <option value="SHORT_TURBO">SHORT_TURBO — короткая дальность/турбо</option>
                  <option value="CUSTOM">CUSTOM — настраиваемый</option>
                </select>
              </div>
              <div class="dcp-field">
                <label>Лимит хопов (1–7)</label>
                <input type="number" min="1" max="7"
                  :value="num('lora','hop_limit')"
                  @input="setNum('lora','hop_limit', $event.target.value)" />
              </div>
              <div class="dcp-field">
                <label>Мощность TX (дБм, 0 = максимум)</label>
                <input type="number" min="0" max="30"
                  :value="num('lora','tx_power')"
                  @input="setNum('lora','tx_power', $event.target.value)" />
              </div>
              <div class="dcp-field">
                <label>Номер канала (0 = первичный)</label>
                <input type="number" min="0" max="104"
                  :value="num('lora','channel_num')"
                  @input="setNum('lora','channel_num', $event.target.value)" />
              </div>
              <div class="dcp-field">
                <label>Ширина полосы (кГц, для CUSTOM пресета)</label>
                <select :value="num('lora','bandwidth')" @change="setNum('lora','bandwidth',$event.target.value)">
                  <option value="0">0 — не задана</option>
                  <option value="125">125 кГц</option>
                  <option value="250">250 кГц</option>
                  <option value="500">500 кГц</option>
                  <option value="62">62.5 кГц</option>
                  <option value="31">31 кГц</option>
                </select>
              </div>
              <div class="dcp-field">
                <label>Spread Factor (7–12, для CUSTOM)</label>
                <input type="number" min="7" max="12"
                  :value="num('lora','spread_factor')"
                  @input="setNum('lora','spread_factor', $event.target.value)" />
              </div>
              <div class="dcp-field">
                <label>Coding Rate (5–8, для CUSTOM)</label>
                <input type="number" min="5" max="8"
                  :value="num('lora','coding_rate')"
                  @input="setNum('lora','coding_rate', $event.target.value)" />
              </div>
              <div class="dcp-field">
                <label>Смещение частоты (МГц)</label>
                <input type="number" step="0.001"
                  :value="get('lora','frequency_offset') || 0"
                  @input="setFloat('lora','frequency_offset', $event.target.value)" />
              </div>
              <div class="dcp-field">
                <label>Переопределить частоту (МГц, 0 = авто)</label>
                <input type="number" step="0.001" min="0"
                  :value="get('lora','override_frequency') || 0"
                  @input="setFloat('lora','override_frequency', $event.target.value)" />
              </div>
              <div class="dcp-toggles">
                <DcpToggle label="Использовать пресет" desc="Использовать встроенный пресет модема вместо CUSTOM настроек" :model-value="bool('lora','use_preset')" @update:model-value="toggle('lora','use_preset', $event)" />
                <DcpToggle label="TX включён" desc="Разрешить передачу. Отключите для режима только приёма" :model-value="bool('lora','tx_enabled')" @update:model-value="toggle('lora','tx_enabled', $event)" />
                <DcpToggle label="Переопределить Duty Cycle" desc="Снять ограничение 1% duty cycle (только для тестирования!)" :model-value="bool('lora','override_duty_cycle')" @update:model-value="toggle('lora','override_duty_cycle', $event)" />
                <DcpToggle label="SX126x RX Boosted Gain" desc="Улучшенный режим приёма для чипов SX1262 (повышает ток на ~2 мА)" :model-value="bool('lora','sx126x_rx_boosted_gain')" @update:model-value="toggle('lora','sx126x_rx_boosted_gain', $event)" />
                <DcpToggle label="Отключить вентилятор PA" desc="Отключить управление вентилятором усилителя мощности" :model-value="bool('lora','pa_fan_disabled')" @update:model-value="toggle('lora','pa_fan_disabled', $event)" />
                <DcpToggle label="Игнорировать MQTT" desc="Не ретранслировать пакеты, пришедшие через MQTT" :model-value="bool('lora','ignore_mqtt')" @update:model-value="toggle('lora','ignore_mqtt', $event)" />
                <DcpToggle label="OK to MQTT" desc="Разрешить шлюзам публиковать пакеты этой ноды в MQTT" :model-value="bool('lora','config_ok_to_mqtt')" @update:model-value="toggle('lora','config_ok_to_mqtt', $event)" />
              </div>
            </template>

            <!-- Position -->
            <template v-else-if="activeTab === 'position'">
              <div class="dcp-section-title">Позиция и GPS</div>
              <div class="dcp-field">
                <label>Режим GPS</label>
                <select :value="get('position','gps_mode')" @change="set('position','gps_mode',$event.target.value)">
                  <option value="DISABLED">DISABLED — выключен</option>
                  <option value="ENABLED">ENABLED — включён</option>
                  <option value="NOT_PRESENT">NOT_PRESENT — отсутствует</option>
                </select>
              </div>
              <div class="dcp-field">
                <label>Интервал рассылки позиции (сек)</label>
                <input type="number" min="0"
                  :value="num('position','position_broadcast_secs')"
                  @input="setNum('position','position_broadcast_secs', $event.target.value)" />
              </div>
              <div class="dcp-field">
                <label>Интервал обновления GPS (сек)</label>
                <input type="number" min="0"
                  :value="num('position','gps_update_interval')"
                  @input="setNum('position','gps_update_interval', $event.target.value)" />
              </div>
              <div class="dcp-field">
                <label>Мин. расстояние для умной рассылки (м)</label>
                <input type="number" min="0"
                  :value="num('position','broadcast_smart_minimum_distance')"
                  @input="setNum('position','broadcast_smart_minimum_distance', $event.target.value)" />
              </div>
              <div class="dcp-field">
                <label>Мин. интервал умной рассылки (сек)</label>
                <input type="number" min="0"
                  :value="num('position','broadcast_smart_minimum_interval_secs')"
                  @input="setNum('position','broadcast_smart_minimum_interval_secs', $event.target.value)" />
              </div>
              <div class="dcp-toggles">
                <DcpToggle label="Умная рассылка позиции" desc="Отправлять позицию только при значимом перемещении" :model-value="bool('position','position_broadcast_smart_enabled')" @update:model-value="toggle('position','position_broadcast_smart_enabled', $event)" />
                <DcpToggle label="Фиксированная позиция" desc="Использовать заданные координаты вместо данных GPS" :model-value="bool('position','fixed_position')" @update:model-value="toggle('position','fixed_position', $event)" />
              </div>
              <div v-if="bool('position','fixed_position')" class="dcp-fixed-position">
                <div class="dcp-section-title" style="margin-top:12px">Фиксированные координаты</div>
                <div class="dcp-coords-row">
                  <div class="dcp-field" style="flex:1">
                    <label>Широта</label>
                    <input type="number" step="0.0000001"
                      :value="(num('position','latitude_i') / 1e7).toFixed(7)"
                      @input="setNum('position','latitude_i', Math.round(parseFloat($event.target.value) * 1e7))" />
                  </div>
                  <div class="dcp-field" style="flex:1">
                    <label>Долгота</label>
                    <input type="number" step="0.0000001"
                      :value="(num('position','longitude_i') / 1e7).toFixed(7)"
                      @input="setNum('position','longitude_i', Math.round(parseFloat($event.target.value) * 1e7))" />
                  </div>
                  <div class="dcp-field" style="flex:0 0 auto; align-self:flex-end">
                    <button class="dcp-map-btn" @click="openMapModal">🗺 Карта</button>
                  </div>
                </div>
                <div class="dcp-field">
                  <label>Высота (м)</label>
                  <input type="number"
                    :value="num('position','altitude')"
                    @input="setNum('position','altitude', $event.target.value)" />
                </div>
              </div>
            </template>

            <!-- Power -->
            <template v-else-if="activeTab === 'power'">
              <div class="dcp-section-title">Питание</div>
              <div class="dcp-toggles">
                <DcpToggle label="Режим энергосбережения" desc="Глубокий сон между рассылками для максимальной экономии батареи" :model-value="bool('power','is_power_saving')" @update:model-value="toggle('power','is_power_saving', $event)" />
              </div>
              <div class="dcp-field">
                <label>Выключение на батарее через (сек, 0 = выкл)</label>
                <input type="number" min="0"
                  :value="num('power','on_battery_shutdown_after_secs')"
                  @input="setNum('power','on_battery_shutdown_after_secs', $event.target.value)" />
              </div>
              <div class="dcp-field">
                <label>Выключение при заряде ниже (%)</label>
                <input type="number" min="0" max="100"
                  :value="num('power','battery_soc_shutdown_threshold')"
                  @input="setNum('power','battery_soc_shutdown_threshold', $event.target.value)" />
              </div>
              <div class="dcp-field">
                <label>Ожидание BT перед sleep (сек)</label>
                <input type="number" min="0"
                  :value="num('power','wait_bluetooth_secs')"
                  @input="setNum('power','wait_bluetooth_secs', $event.target.value)" />
              </div>
              <div class="dcp-field">
                <label>Таймаут super deep sleep (сек, 0 = выкл)</label>
                <input type="number" min="0"
                  :value="num('power','sds_secs')"
                  @input="setNum('power','sds_secs', $event.target.value)" />
              </div>
              <div class="dcp-field">
                <label>Таймаут light sleep (сек)</label>
                <input type="number" min="0"
                  :value="num('power','ls_secs')"
                  @input="setNum('power','ls_secs', $event.target.value)" />
              </div>
              <div class="dcp-field">
                <label>Мин. время пробуждения (сек)</label>
                <input type="number" min="0"
                  :value="num('power','min_wake_secs')"
                  @input="setNum('power','min_wake_secs', $event.target.value)" />
              </div>
            </template>

            <!-- Network -->
            <template v-else-if="activeTab === 'network'">
              <div class="dcp-section-title">Сеть</div>
              <div class="dcp-toggles">
                <DcpToggle label="WiFi включён" :model-value="bool('network','wifi_enabled')" @update:model-value="toggle('network','wifi_enabled', $event)" />
                <DcpToggle label="Ethernet включён" :model-value="bool('network','eth_enabled')" @update:model-value="toggle('network','eth_enabled', $event)" />
                <DcpToggle label="IPv6 включён" :model-value="bool('network','ipv6_enabled')" @update:model-value="toggle('network','ipv6_enabled', $event)" />
              </div>
              <div class="dcp-field">
                <label>SSID</label>
                <input type="text" maxlength="32"
                  :value="get('network','wifi_ssid')"
                  @input="set('network','wifi_ssid', $event.target.value)" />
              </div>
              <div class="dcp-field">
                <label>Пароль WiFi</label>
                <input type="password" maxlength="64"
                  :value="get('network','wifi_psk')"
                  @input="set('network','wifi_psk', $event.target.value)" />
              </div>
              <div class="dcp-field">
                <label>NTP сервер</label>
                <input type="text" placeholder="0.pool.ntp.org"
                  :value="get('network','ntp_server')"
                  @input="set('network','ntp_server', $event.target.value)" />
              </div>
              <div class="dcp-field">
                <label>Rsyslog сервер</label>
                <input type="text" placeholder="192.168.1.100:514"
                  :value="get('network','rsyslog_server')"
                  @input="set('network','rsyslog_server', $event.target.value)" />
              </div>
              <div class="dcp-field">
                <label>Режим адресации</label>
                <select :value="get('network','address_mode')" @change="set('network','address_mode',$event.target.value)">
                  <option value="DHCP">DHCP — автоматически</option>
                  <option value="STATIC">STATIC — статический IP</option>
                </select>
              </div>
            </template>

            <!-- Display -->
            <template v-else-if="activeTab === 'display'">
              <div class="dcp-section-title">Экран</div>
              <div class="dcp-field">
                <label>Время до отключения экрана (сек, 0 = всегда)</label>
                <input type="number" min="0"
                  :value="num('display','screen_on_secs')"
                  @input="setNum('display','screen_on_secs', $event.target.value)" />
              </div>
              <div class="dcp-field">
                <label>Интервал карусели экранов (сек, 0 = выкл)</label>
                <input type="number" min="0"
                  :value="num('display','auto_screen_carousel_secs')"
                  @input="setNum('display','auto_screen_carousel_secs', $event.target.value)" />
              </div>
              <div class="dcp-field">
                <label>Единицы измерения</label>
                <select :value="get('display','units')" @change="set('display','units',$event.target.value)">
                  <option value="METRIC">METRIC — метрические</option>
                  <option value="IMPERIAL">IMPERIAL — имперские</option>
                </select>
              </div>
              <div class="dcp-field">
                <label>Тип OLED</label>
                <select :value="get('display','oled')" @change="set('display','oled',$event.target.value)">
                  <option value="OLED_AUTO">OLED_AUTO — автоопределение</option>
                  <option value="OLED_SSD1306">OLED_SSD1306</option>
                  <option value="OLED_SH1106">OLED_SH1106</option>
                  <option value="OLED_SH1107">OLED_SH1107</option>
                </select>
              </div>
              <div class="dcp-field">
                <label>Режим отображения</label>
                <select :value="get('display','displaymode')" @change="set('display','displaymode',$event.target.value)">
                  <option value="DEFAULT">DEFAULT — стандартный</option>
                  <option value="TWOCOLOR">TWOCOLOR — двухцветный</option>
                  <option value="INVERTED">INVERTED — инвертированный</option>
                  <option value="COLOR">COLOR — цветной</option>
                </select>
              </div>
              <div class="dcp-toggles">
                <DcpToggle label="Перевернуть экран" :model-value="bool('display','flip_screen')" @update:model-value="toggle('display','flip_screen', $event)" />
                <DcpToggle label="Жирный заголовок" :model-value="bool('display','heading_bold')" @update:model-value="toggle('display','heading_bold', $event)" />
                <DcpToggle label="Включение по tap / движению" :model-value="bool('display','wake_on_tap_or_motion')" @update:model-value="toggle('display','wake_on_tap_or_motion', $event)" />
                <DcpToggle label="12-часовой формат времени" :model-value="bool('display','use_12h_clock')" @update:model-value="toggle('display','use_12h_clock', $event)" />
                <DcpToggle label="Длинное имя ноды" :model-value="bool('display','use_long_node_name')" @update:model-value="toggle('display','use_long_node_name', $event)" />
                <DcpToggle label="Пузырьки сообщений" :model-value="bool('display','enable_message_bubbles')" @update:model-value="toggle('display','enable_message_bubbles', $event)" />
              </div>
            </template>

            <!-- Bluetooth -->
            <template v-else-if="activeTab === 'bluetooth'">
              <div class="dcp-section-title">Bluetooth</div>
              <div class="dcp-toggles">
                <DcpToggle label="Bluetooth включён" :model-value="bool('bluetooth','enabled')" @update:model-value="toggle('bluetooth','enabled', $event)" />
              </div>
              <div class="dcp-field">
                <label>Режим сопряжения</label>
                <select :value="get('bluetooth','mode')" @change="set('bluetooth','mode',$event.target.value)">
                  <option value="RANDOM_PIN">RANDOM_PIN — случайный PIN</option>
                  <option value="FIXED_PIN">FIXED_PIN — фиксированный PIN</option>
                  <option value="NO_PIN">NO_PIN — без PIN</option>
                </select>
              </div>
              <div class="dcp-field" v-if="get('bluetooth','mode') === 'FIXED_PIN'">
                <label>Фиксированный PIN</label>
                <input type="number" min="0" max="999999"
                  :value="num('bluetooth','fixed_pin')"
                  @input="setNum('bluetooth','fixed_pin', $event.target.value)" />
              </div>
            </template>

            <!-- Security -->
            <template v-else-if="activeTab === 'security'">
              <div class="dcp-section-title">Безопасность</div>
              <div class="dcp-field">
                <label>Публичный ключ</label>
                <div class="dcp-readonly">{{ get('security','public_key') || '—' }}</div>
              </div>
              <div class="dcp-field">
                <label>Приватный ключ (секретный)</label>
                <div class="dcp-secret-row">
                  <div class="dcp-readonly dcp-secret-value">
                    {{ showPrivateKey ? (get('security','private_key') || '—') : '••••••••••••••••••••••••••••••••••••••••••••' }}
                  </div>
                  <button class="dcp-eye-btn" @click="showPrivateKey = !showPrivateKey" :title="showPrivateKey ? 'Скрыть' : 'Показать'">
                    {{ showPrivateKey ? '🙈' : '👁' }}
                  </button>
                </div>
                <div class="dcp-hint">Приватный ключ нельзя изменить здесь. Используется для бэкапа/восстановления.</div>
              </div>
              <div class="dcp-toggles">
                <DcpToggle label="Serial консоль включена" desc="Разрешить управление через UART/USB serial порт" :model-value="bool('security','serial_enabled')" @update:model-value="toggle('security','serial_enabled', $event)" />
                <DcpToggle label="Debug Log API включён" desc="Выдавать отладочные логи через API" :model-value="bool('security','debug_log_api_enabled')" @update:model-value="toggle('security','debug_log_api_enabled', $event)" />
                <DcpToggle label="Управление через primary канал" desc="Разрешить admin-команды без шифрованного ключа" :model-value="bool('security','admin_channel_enabled')" @update:model-value="toggle('security','admin_channel_enabled', $event)" />
                <DcpToggle label="Managed устройство" desc="Устройство управляется централизованно, пользователь не может менять настройки" :model-value="bool('security','is_managed')" @update:model-value="toggle('security','is_managed', $event)" />
              </div>
            </template>

            <!-- MQTT -->
            <template v-else-if="activeTab === 'mqtt'">
              <div class="dcp-section-title">MQTT</div>
              <div class="dcp-toggles" style="margin-bottom:14px">
                <DcpToggle label="MQTT включён" desc="Подключить ноду к MQTT-брокеру" :model-value="bool('mqtt','enabled')" @update:model-value="toggle('mqtt','enabled', $event)" />
                <DcpToggle label="Шифрование пакетов" desc="Отправлять зашифрованные пакеты в MQTT (рекомендуется)" :model-value="bool('mqtt','encryption_enabled')" @update:model-value="toggle('mqtt','encryption_enabled', $event)" />
                <DcpToggle label="TLS" desc="Использовать защищённое соединение с брокером" :model-value="bool('mqtt','tls_enabled')" @update:model-value="toggle('mqtt','tls_enabled', $event)" />
                <DcpToggle label="JSON формат" desc="Публиковать пакеты в JSON вместо protobuf" :model-value="bool('mqtt','json_enabled')" @update:model-value="toggle('mqtt','json_enabled', $event)" />
                <DcpToggle label="Proxy к клиенту" desc="Проксировать MQTT-соединение через телефон/клиент" :model-value="bool('mqtt','proxy_to_client_enabled')" @update:model-value="toggle('mqtt','proxy_to_client_enabled', $event)" />
                <DcpToggle label="Map reporting" desc="Публиковать позицию ноды на карту (meshmap)" :model-value="bool('mqtt','map_reporting_enabled')" @update:model-value="toggle('mqtt','map_reporting_enabled', $event)" />
              </div>
              <div class="dcp-field">
                <label>Адрес брокера</label>
                <input type="text" :value="get('mqtt','address')"
                  @change="set('mqtt','address', $event.target.value)"
                  placeholder="mqtt.meshtastic.org" />
              </div>
              <div class="dcp-field">
                <label>Логин</label>
                <input type="text" :value="get('mqtt','username')"
                  @change="set('mqtt','username', $event.target.value)" />
              </div>
              <div class="dcp-field">
                <label>Пароль</label>
                <input type="text" :value="get('mqtt','password')"
                  @change="set('mqtt','password', $event.target.value)" />
              </div>
              <div class="dcp-field">
                <label>Root topic</label>
                <input type="text" :value="get('mqtt','root')"
                  @change="set('mqtt','root', $event.target.value)"
                  placeholder="msh" />
              </div>
              <template v-if="bool('mqtt','map_reporting_enabled')">
                <div class="dcp-section-title" style="margin-top:12px">Map reporting</div>
                <div class="dcp-field">
                  <label>Точность позиции (1–14)</label>
                  <input type="number" min="1" max="14"
                    :value="current?.mqtt?.map_report_settings?.position_precision ?? 0"
                    @change="current.mqtt.map_report_settings = {...(current.mqtt.map_report_settings||{}), position_precision: parseInt($event.target.value)||0}" />
                </div>
                <div class="dcp-field">
                  <label>Интервал публикации (сек)</label>
                  <input type="number" min="0"
                    :value="current?.mqtt?.map_report_settings?.publish_interval_secs ?? 0"
                    @change="current.mqtt.map_report_settings = {...(current.mqtt.map_report_settings||{}), publish_interval_secs: parseInt($event.target.value)||0}" />
                </div>
              </template>
            </template>

          </div>
        </template>

        <div v-if="toast" class="dcp-toast" :class="toast.type">{{ toast.msg }}</div>
      </div>
    </div>

    <!-- Map modal -->
    <div v-if="showMapModal" class="dcp-map-overlay" @click.self="showMapModal = false">
      <div class="dcp-map-modal">
        <div class="dcp-map-modal-header">
          <span>Выберите точку на карте</span>
          <button class="dcp-close-btn" @click="showMapModal = false">✕</button>
        </div>
        <div id="dcp-map" class="dcp-map-container"></div>
        <div class="dcp-map-modal-footer">
          <span class="dcp-map-coords" v-if="mapPickLat !== null">
            {{ mapPickLat.toFixed(6) }}, {{ mapPickLng.toFixed(6) }}
          </span>
          <button class="dcp-save-btn" @click="confirmMapPick">Выбрать</button>
        </div>
      </div>
    </div>
  `,
}
