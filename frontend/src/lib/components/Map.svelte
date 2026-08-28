<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  export let lat: number = -37.8136;
  export let lng: number = 144.9631;
  export let zoom: number = 15;
  export let title: string = 'BAI Business Hub';

  let mapEl: HTMLDivElement;
  let map: any;
  let L: any;

  onMount(async () => {
    if (typeof window === 'undefined') return;

    L = await import('leaflet');

    await import('leaflet/dist/leaflet.css');

    map = L.map(mapEl, {
      center: [lat, lng],
      zoom,
      scrollWheelZoom: false
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19
    }).addTo(map);

    const icon = L.divIcon({
      html: `<div class="w-8 h-8 bg-primary-600 rounded-full border-2 border-white shadow-lg flex items-center justify-center">
        <svg class="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
        </svg>
      </div>`,
      className: '',
      iconSize: [32, 32],
      iconAnchor: [16, 32],
      popupAnchor: [0, -32]
    });

    L.marker([lat, lng], { icon })
      .addTo(map)
      .bindPopup(`<strong>${title}</strong><br/>Visit us today!`)
      .openPopup();

    setTimeout(() => map.invalidateSize(), 100);
  });

  onDestroy(() => {
    if (map) map.remove();
  });
</script>

<div bind:this={mapEl} class="w-full h-full rounded-xl"></div>

<style>
  div :global(.leaflet-popup-content-wrapper) {
    background: #ffffff;
    color: #111315;
    border-radius: 0.75rem;
    border: 1px solid #e2e5ec;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  }
  div :global(.leaflet-popup-tip) {
    background: #ffffff;
    border: 1px solid #e2e5ec;
  }
  div :global(.leaflet-popup-close-button) {
    color: #6b7180;
  }
</style>
