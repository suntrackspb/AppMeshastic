import { formatUptime, formatLastSeen } from '../utils/format.js'

const NodeInfoModal = {
  props: {
    node: Object,
    tracerouteHistory: Array,
    traceroutePending: Boolean,
  },

  emits: [
    'close',
    'open-dm',
    'exchange-user-info',
    'trace-route',
    'toggle-favorite',
    'toggle-ignore',
    'confirm-delete',
    'show-traceroute',
  ],

  data() {
    return {
      view: 'info',
    }
  },

  watch: {
    node() {
      this.view = 'info'
    },
  },

  methods: {
    formatUptime,
    formatLastSeen,
  },

  template: `
    <div class="node-info-overlay" @click.self="$emit('close')">
      <div class="node-info-modal">
        <button class="node-info-close" @click="$emit('close')">✕</button>
        <h3>{{ node.long_name || node.short_name || node.node_id }}</h3>
        <div class="node-action-buttons">
          <button @click="$emit('open-dm', node); $emit('close')" title="Написать сообщение">✉️</button>
          <button @click="$emit('exchange-user-info', node)" title="Запросить информацию о ноде">🔄</button>
          <button @click="$emit('trace-route', node)" :class="{ pending: traceroutePending }" title="Трассировка маршрута">{{ traceroutePending ? '⏳' : '🔀' }}</button>
          <button @click="$emit('toggle-favorite', node)" :class="{ active: node.is_favorite }" :title="node.is_favorite ? 'Убрать из избранного' : 'Добавить в избранное'">{{ node.is_favorite ? '⛔️' : '⭐️' }}</button>
          <button @click="$emit('toggle-ignore', node)" :class="{ active: node.is_ignored }" :title="node.is_ignored ? 'Снять игнор' : 'Игнорировать ноду'">🚫</button>
          <button @click="$emit('confirm-delete', node)" class="danger" title="Удалить ноду">🚮</button>
          <div class="node-action-sep"></div>
          <button @click="view = 'info'" :class="{ active: view === 'info' }" title="Информация о ноде">ℹ️</button>
          <button @click="view = 'traceroute'; $emit('show-traceroute')" :class="{ active: view === 'traceroute' }" title="История трассировок">🔂</button>
        </div>

        <table v-if="view === 'info'" class="node-info-table">
          <tr v-if="node.node_id"><td>ID</td><td>{{ node.node_id }}</td></tr>
          <tr v-if="node.short_name"><td>Short name</td><td>{{ node.short_name }}</td></tr>
          <tr v-if="node.long_name"><td>Long name</td><td>{{ node.long_name }}</td></tr>
          <tr v-if="node.hw_model"><td>Железо</td><td>{{ node.hw_model }}</td></tr>
          <tr v-if="node.role"><td>Роль</td><td>{{ node.role }}</td></tr>
          <tr v-if="node.city"><td>Город</td><td>{{ node.city }}</td></tr>
          <tr v-if="node.firmware_version"><td>Прошивка</td><td>{{ node.firmware_version }}</td></tr>
          <tr v-if="node.latitude != null"><td>Координаты</td><td>{{ node.latitude }}, {{ node.longitude }}</td></tr>
          <tr v-if="node.altitude != null"><td>Высота</td><td>{{ node.altitude }} м</td></tr>
          <tr v-if="node.battery_level != null"><td>Батарея</td><td>{{ parseFloat(node.battery_level).toFixed(1) }}%</td></tr>
          <tr v-if="node.voltage != null"><td>Напряжение</td><td>{{ parseFloat(node.voltage).toFixed(1) }} В</td></tr>
          <tr v-if="node.channel_utilization != null"><td>Загр. канала</td><td>{{ parseFloat(node.channel_utilization).toFixed(1) }}%</td></tr>
          <tr v-if="node.air_util_tx != null"><td>Air util TX</td><td>{{ parseFloat(node.air_util_tx).toFixed(1) }}%</td></tr>
          <tr v-if="node.uptime_seconds != null"><td>Аптайм</td><td>{{ formatUptime(node.uptime_seconds) }}</td></tr>
          <tr v-if="node.snr != null"><td>Последний SNR</td><td>{{ parseFloat(node.snr).toFixed(1) }} dB</td></tr>
          <tr v-if="node.rssi != null"><td>RSSI</td><td>{{ node.rssi }} dBm</td></tr>
          <tr v-if="node.temperature != null"><td>Температура</td><td>{{ parseFloat(node.temperature).toFixed(1) }} °C</td></tr>
          <tr v-if="node.humidity != null"><td>Влажность</td><td>{{ parseFloat(node.humidity).toFixed(1) }}%</td></tr>
          <tr v-if="node.pressure != null"><td>Давление</td><td>{{ parseFloat(node.pressure).toFixed(1) }} гПа</td></tr>
          <tr v-if="node.last_seen_at"><td>Последний раз</td><td>{{ formatLastSeen(node.last_seen_at, true) }}</td></tr>
        </table>

        <div v-else-if="view === 'traceroute'" class="traceroute-section">
          <div v-if="traceroutePending" class="traceroute-pending">⏳ Трассировка выполняется...</div>
          <div v-if="!tracerouteHistory.length && !traceroutePending" class="traceroute-empty">Нет истории трассировок</div>
          <div v-for="tr in tracerouteHistory" :key="tr.id || tr.requested_at" class="traceroute-entry">
            <div class="traceroute-time">{{ formatLastSeen(tr.requested_at) }}</div>
            <div v-if="!tr.completed_at" class="traceroute-pending">ожидание ответа...</div>
            <div v-else-if="tr.timed_out" class="traceroute-timeout">нет ответа (таймаут)</div>
            <template v-else>
              <div class="traceroute-route">
                ➡ <span v-for="(hop, i) in tr.forward_route" :key="i">
                  <span v-if="i > 0"> → </span>{{ hop.name || hop.node_id || hop }}<span v-if="hop.snr != null" class="traceroute-snr"> ({{ hop.snr }}dB)</span>
                </span>
              </div>
              <div class="traceroute-route">
                ⬅ <span v-for="(hop, i) in tr.return_route" :key="i">
                  <span v-if="i > 0"> → </span>{{ hop.name || hop.node_id || hop }}<span v-if="hop.snr != null" class="traceroute-snr"> ({{ hop.snr }}dB)</span>
                </span>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>
  `,
}

export default NodeInfoModal
