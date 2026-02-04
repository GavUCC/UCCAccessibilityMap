// Create the map
const map = L.map('map').setView([51.505, -0.09], 13);

// OpenStreetMap tiles
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
}).addTo(map);

// Marker example
L.marker([51.505, -0.09])
    .addTo(map)
    .bindPopup('Hello from Leaflet!')
    .openPopup();