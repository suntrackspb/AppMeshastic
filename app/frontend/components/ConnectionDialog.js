export default {
  name: 'ConnectionDialog',
  emits: ['connected', 'close'],
  data() {
    return {
      type: 'serial',
      serialPort: '',
      serialPorts: [],
      bleAddress: '',
      bleDevices: [],
      bleScanning: false,
      wifiHost: '',
      wifiPort: 4403,
      connecting: false,
      error: null,
      history: [],
    }
  },
  async mounted() {
    await Promise.all([this.refreshPorts(), this.loadHistory()])
  },
  methods: {
    async loadHistory() {
      this.history = await window.pywebview.api.get_connection_history()
    },
    async refreshPorts() {
      this.serialPorts = await window.pywebview.api.list_serial_ports()
      if (this.serialPorts.length) this.serialPort = this.serialPorts[0]
    },
    async scanBle() {
      this.bleScanning = true
      this.bleDevices = []
      this.error = null
      try {
        this.bleDevices = await window.pywebview.api.scan_ble_devices()
        if (!this.bleDevices.length) this.error = 'Meshtastic BLE устройства не найдены'
      } catch (e) {
        this.error = e.message || String(e)
      } finally {
        this.bleScanning = false
      }
    },
    async connect() {
      this.connecting = true
      this.error = null
      try {
        const params = this.buildParams()
        const nodeId = await window.pywebview.api.connect_node(this.type, params)
        this.$emit('connected', { nodeId, type: this.type, params })
        await this.loadHistory()
        this.$emit('close')
      } catch (e) {
        this.error = e.message || String(e)
      } finally {
        this.connecting = false
      }
    },
    async connectFromHistory(entry) {
      this.connecting = true
      this.error = null
      try {
        const nodeId = await window.pywebview.api.connect_node(entry.type, entry.params)
        this.$emit('connected', { nodeId, type: entry.type, params: entry.params })
        await this.loadHistory()
        this.$emit('close')
      } catch (e) {
        this.error = e.message || String(e)
      } finally {
        this.connecting = false
      }
    },
    async deleteHistory(key) {
      await window.pywebview.api.delete_connection_history_entry(key)
      this.history = this.history.filter(e => e.key !== key)
    },
    buildParams() {
      if (this.type === 'serial') return { port: this.serialPort }
      if (this.type === 'ble') return { address: this.bleAddress }
      return { host: this.wifiHost, port: this.wifiPort }
    },
    historyLabel(entry) {
      if (entry.type === 'serial') return entry.params.port
      if (entry.type === 'ble') return entry.params.address
      const port = entry.params.port || 4403
      return port === 4403 ? entry.params.host : `${entry.params.host}:${port}`
    },
    historyBadge(type) {
      if (type === 'serial') return 'Serial'
      if (type === 'ble') return 'BLE'
      return 'Wi-Fi'
    },
  },
  template: `
    <div class="dialog-overlay" @click.self="$emit('close')">
      <div class="dialog">
        <div class="dialog-header">
          <h2>Подключить ноду</h2>
          <button class="btn-icon" @click="$emit('close')">✕</button>
        </div>

        <template v-if="history.length">
          <div class="history-section">
            <div class="history-label">Последние подключения</div>
            <div v-for="entry in history" :key="entry.key" class="history-item">
              <button class="history-connect" @click="connectFromHistory(entry)" :disabled="connecting">
                <span class="history-badge">{{ historyBadge(entry.type) }}</span>
                <span class="history-name">{{ historyLabel(entry) }}</span>
              </button>
              <button class="btn-icon history-delete" @click="deleteHistory(entry.key)" v-tooltip="'Удалить'">✕</button>
            </div>
          </div>
          <div class="dialog-divider">или новое подключение</div>
        </template>

        <div class="dialog-tabs">
          <button :class="{ active: type === 'serial' }" @click="type = 'serial'">Serial</button>
          <button :class="{ active: type === 'ble' }" @click="type = 'ble'">BLE</button>
          <button :class="{ active: type === 'wifi' }" @click="type = 'wifi'">Wi-Fi</button>
        </div>

        <div class="dialog-body">
          <template v-if="type === 'serial'">
            <label>Порт</label>
            <div class="row">
              <select v-model="serialPort">
                <option v-for="p in serialPorts" :key="p" :value="p">{{ p }}</option>
              </select>
              <button class="btn-icon" @click="refreshPorts" v-tooltip="'Обновить'">↻</button>
            </div>
          </template>

          <template v-else-if="type === 'ble'">
            <label>BLE адрес</label>
            <div class="row">
              <input v-model="bleAddress" placeholder="XX:XX:XX:XX:XX:XX" style="flex:1" />
              <button class="btn-icon" @click="scanBle" :disabled="bleScanning" v-tooltip="'Поиск устройств'">
                {{ bleScanning ? '⟳' : '🔍' }}
              </button>
            </div>
            <div v-if="bleDevices.length" class="ble-devices">
              <div
                v-for="d in bleDevices"
                :key="d.address"
                class="ble-device"
                :class="{ selected: bleAddress === d.address }"
                @click="bleAddress = d.address"
              >
                <span class="ble-device-name">{{ d.name || '(без имени)' }}</span>
                <span class="ble-device-addr">{{ d.address }}</span>
              </div>
            </div>
            <p v-else-if="!bleScanning" class="hint">Нажмите 🔍 для поиска Meshtastic устройств</p>
          </template>

          <template v-else>
            <label>Хост</label>
            <input v-model="wifiHost" placeholder="192.168.1.100" />
            <label>Порт</label>
            <input v-model.number="wifiPort" type="number" />
          </template>

          <p v-if="error" class="error">{{ error }}</p>
        </div>

        <div class="dialog-footer">
          <button @click="$emit('close')" :disabled="connecting">Отмена</button>
          <button class="btn-primary" @click="connect" :disabled="connecting">
            {{ connecting ? 'Подключение...' : 'Подключить' }}
          </button>
        </div>

        <div v-if="connecting" class="connecting-overlay">
          <div class="connecting-spinner"></div>
          <div class="connecting-text">Подключение к ноде...</div>
        </div>
      </div>
    </div>
  `,
}
