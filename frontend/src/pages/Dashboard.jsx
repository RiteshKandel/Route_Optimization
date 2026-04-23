import React, { useState, useEffect, useCallback, useRef } from 'react';
import { GoogleMap, useJsApiLoader, Marker, DirectionsRenderer, InfoWindow } from '@react-google-maps/api';
import axios from 'axios';

const API = 'http://localhost:5000/api/locations';

const mapContainerStyle = {
  width: '100%',
  height: '100%',
};

const defaultCenter = { lat: 23.0225, lng: 72.5714 }; // Ahmedabad, India

// Vehicle color palette
const VEHICLE_COLORS = [
  { name: 'Cyan',    hex: '#06b6d4', bg: 'rgba(6, 182, 212, 0.15)',  border: 'rgba(6, 182, 212, 0.4)' },
  { name: 'Amber',   hex: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)', border: 'rgba(245, 158, 11, 0.4)' },
  { name: 'Emerald', hex: '#10b981', bg: 'rgba(16, 185, 129, 0.15)', border: 'rgba(16, 185, 129, 0.4)' },
  { name: 'Rose',    hex: '#f43f5e', bg: 'rgba(244, 63, 94, 0.15)',  border: 'rgba(244, 63, 94, 0.4)' },
  { name: 'Violet',  hex: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.15)', border: 'rgba(139, 92, 246, 0.4)' },
];

const Dashboard = () => {
  const [locations, setLocations] = useState([]);
  const [optimizedRoute, setOptimizedRoute] = useState(null);     // single-vehicle result
  const [vrpResult, setVrpResult] = useState(null);                // multi-vehicle result
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [routeStats, setRouteStats] = useState(null);
  const [directionsResult, setDirectionsResult] = useState(null);  // single-vehicle directions
  const [vrpDirections, setVrpDirections] = useState([]);           // multi-vehicle directions array
  const [vehicleCount, setVehicleCount] = useState(1);
  const [expandedVehicle, setExpandedVehicle] = useState(null);

  const { isLoaded } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '',
  });

  const [map, setMap] = useState(null);

  const onLoad = useCallback((map) => setMap(map), []);
  const onUnmount = useCallback(() => setMap(null), []);

  // Fetch locations from backend
  const fetchLocations = async () => {
    try {
      const res = await axios.get(API);
      setLocations(res.data);
    } catch (err) {
      console.error('Error fetching locations:', err);
    }
  };

  useEffect(() => {
    fetchLocations();
  }, []);

  // Click on map to add a location
  const handleMapClick = async (e) => {
    const lat = e.latLng.lat();
    const lng = e.latLng.lng();
    const name = prompt('Enter a name for this location:', `Location ${locations.length + 1}`);
    if (!name || name.trim() === '') return;

    try {
      await axios.post(API, { name: name.trim(), lat, lng });
      clearOptimization();
      fetchLocations();
    } catch (err) {
      console.error('Error adding location:', err);
    }
  };

  // Delete a single location
  const handleDeleteLocation = async (id) => {
    try {
      await axios.delete(`${API}/${id}`);
      clearOptimization();
      setSelectedLocation(null);
      fetchLocations();
    } catch (err) {
      console.error('Error deleting location:', err);
    }
  };

  // Clear all locations
  const handleClearAll = async () => {
    if (!confirm('Remove all locations and reset the map?')) return;
    try {
      await axios.delete(API);
      setLocations([]);
      clearOptimization();
      setSelectedLocation(null);
    } catch (err) {
      console.error('Error clearing locations:', err);
    }
  };

  // Clear optimization state
  const clearOptimization = () => {
    setOptimizedRoute(null);
    setVrpResult(null);
    setRouteStats(null);
    setDirectionsResult(null);
    setVrpDirections([]);
    setExpandedVehicle(null);
  };

  // ─── Request Google Directions for a list of ordered locations ───
  const requestDirections = (orderedLocs, color, callback) => {
    if (!window.google || orderedLocs.length < 2) return;

    const directionsService = new window.google.maps.DirectionsService();
    const origin = { lat: orderedLocs[0].lat, lng: orderedLocs[0].lng };
    const destination = { lat: orderedLocs[orderedLocs.length - 1].lat, lng: orderedLocs[orderedLocs.length - 1].lng };

    const waypoints = orderedLocs.slice(1, -1).map(loc => ({
      location: { lat: loc.lat, lng: loc.lng },
      stopover: true
    }));

    directionsService.route(
      {
        origin,
        destination,
        waypoints,
        travelMode: window.google.maps.TravelMode.DRIVING,
        optimizeWaypoints: false,
      },
      (result, status) => {
        if (status === window.google.maps.DirectionsStatus.OK) {
          callback(result);
        } else {
          console.warn('Directions request failed:', status);
          callback(null);
        }
      }
    );
  };

  // ─── Run optimization ───────────────────────────────────────────
  const handleOptimize = async () => {
    if (locations.length < 2) {
      alert('Add at least 2 locations to optimize a route.');
      return;
    }
    setIsOptimizing(true);
    clearOptimization();

    try {
      if (vehicleCount <= 1) {
        // ─── Single vehicle (TSP) ────────────────────────────
        const res = await axios.post(`${API}/optimize`);
        const { orderedLocations, totalDistanceKm, algorithm } = res.data;
        setOptimizedRoute(orderedLocations);
        setRouteStats({ totalDistanceKm, algorithm, stops: orderedLocations.length, mode: 'single' });

        // Request road directions
        requestDirections(orderedLocations, VEHICLE_COLORS[0].hex, (result) => {
          if (result) {
            setDirectionsResult(result);
            const totalRoadDistanceM = result.routes[0].legs.reduce((sum, leg) => sum + leg.distance.value, 0);
            const totalDurationS = result.routes[0].legs.reduce((sum, leg) => sum + leg.duration.value, 0);
            setRouteStats(prev => ({
              ...prev,
              roadDistanceKm: totalRoadDistanceM / 1000,
              durationMin: Math.round(totalDurationS / 60)
            }));
          }
        });

      } else {
        // ─── Multi-vehicle (VRP) ──────────────────────────────
        const res = await axios.post(`${API}/optimize-vrp`, { vehicleCount });
        const { vehicles, totalDistanceKm, algorithm, depot, vehicleCount: effectiveCount } = res.data;

        setVrpResult({ vehicles, depot, effectiveCount });
        setRouteStats({
          totalDistanceKm,
          algorithm,
          stops: locations.length,
          mode: 'multi',
          vehicleCount: effectiveCount
        });

        // Request directions for each vehicle
        const directionsPromises = vehicles.map((vehicle, idx) => {
          return new Promise((resolve) => {
            if (vehicle.orderedLocations.length < 2) {
              resolve(null);
              return;
            }
            requestDirections(vehicle.orderedLocations, VEHICLE_COLORS[idx % VEHICLE_COLORS.length].hex, (result) => {
              if (result) {
                const totalRoadDistanceM = result.routes[0].legs.reduce((sum, leg) => sum + leg.distance.value, 0);
                const totalDurationS = result.routes[0].legs.reduce((sum, leg) => sum + leg.duration.value, 0);
                resolve({
                  directions: result,
                  roadDistanceKm: totalRoadDistanceM / 1000,
                  durationMin: Math.round(totalDurationS / 60)
                });
              } else {
                resolve(null);
              }
            });
          });
        });

        const allDirections = await Promise.all(directionsPromises);
        setVrpDirections(allDirections);

        // Update stats with road distances
        const totalRoadKm = allDirections.reduce((sum, d) => sum + (d?.roadDistanceKm || 0), 0);
        const totalDurMin = allDirections.reduce((sum, d) => sum + (d?.durationMin || 0), 0);
        setRouteStats(prev => ({
          ...prev,
          roadDistanceKm: totalRoadKm,
          durationMin: totalDurMin > 0 ? totalDurMin : undefined
        }));

        // Fit bounds to all locations
        if (map) {
          const bounds = new window.google.maps.LatLngBounds();
          locations.forEach(loc => bounds.extend({ lat: loc.lat, lng: loc.lng }));
          map.fitBounds(bounds, 80);
        }
      }
    } catch (err) {
      alert(err.response?.data?.error || 'Optimization failed');
    } finally {
      setIsOptimizing(false);
    }
  };

  // ─── Export to Google Maps ──────────────────────────────────────
  const handleExportToMaps = (vehicleIdx = null) => {
    let route;

    if (vrpResult && vehicleIdx !== null) {
      route = vrpResult.vehicles[vehicleIdx]?.orderedLocations;
    } else if (optimizedRoute) {
      route = optimizedRoute;
    }

    if (!route || route.length < 2) return;

    const origin = `${route[0].lat},${route[0].lng}`;
    const destination = `${route[route.length - 1].lat},${route[route.length - 1].lng}`;
    let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=driving`;

    if (route.length > 2) {
      const waypoints = route.slice(1, -1).map(loc => `${loc.lat},${loc.lng}`).join('|');
      url += `&waypoints=${waypoints}`;
    }

    window.open(url, '_blank');
  };

  // ─── Determine which locations to display as markers ────────────
  const isMultiVehicle = vrpResult !== null;

  // Get vehicle assignment for a location (for coloring)
  const getVehicleForLocation = (locId) => {
    if (!vrpResult) return -1;
    for (let v = 0; v < vrpResult.vehicles.length; v++) {
      if (vrpResult.vehicles[v].orderedLocations.some(ol => ol._id === locId)) {
        return v;
      }
    }
    return -1;
  };

  // Check if a location is the depot
  const isDepot = (locId) => {
    if (!vrpResult) return false;
    return vrpResult.depot._id === locId;
  };

  // Get order number for a location
  const getOrderNumber = (loc) => {
    if (optimizedRoute) {
      return optimizedRoute.findIndex(ol => ol._id === loc._id) + 1;
    }
    if (vrpResult) {
      for (const v of vrpResult.vehicles) {
        const idx = v.orderedLocations.findIndex(ol => ol._id === loc._id);
        if (idx >= 0) return idx + 1;
      }
    }
    return locations.findIndex(l => l._id === loc._id) + 1;
  };

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 font-sans overflow-hidden">
      
      {/* ─── Sidebar ──────────────────────────────────────────── */}
      <div className="w-96 flex flex-col border-r border-slate-800 bg-slate-900/80 backdrop-blur-md z-10">
        
        {/* Brand */}
        <div className="p-6 border-b border-slate-800">
          <h1 className="text-2xl font-black bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-500 tracking-tight">
            Route Optimizer
          </h1>
          <p className="text-xs text-slate-500 mt-1">Click anywhere on the map to add locations</p>
        </div>

        {/* Vehicle Count Selector */}
        <div className="p-4 mx-4 mt-4 rounded-xl bg-slate-800/50 border border-slate-700/50">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Vehicles</span>
            <span className="text-lg font-black text-white">{vehicleCount}</span>
          </div>
          <input
            type="range"
            min="1"
            max="5"
            value={vehicleCount}
            onChange={(e) => {
              setVehicleCount(Number(e.target.value));
              clearOptimization();
            }}
            className="vehicle-slider w-full"
          />
          <div className="flex justify-between mt-1.5">
            {[1, 2, 3, 4, 5].map(n => (
              <button
                key={n}
                onClick={() => { setVehicleCount(n); clearOptimization(); }}
                className={`w-8 h-8 rounded-lg text-xs font-bold transition-all ${
                  vehicleCount === n
                    ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-500/30'
                    : 'bg-slate-700/50 text-slate-400 hover:bg-slate-700'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          {vehicleCount > 1 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {VEHICLE_COLORS.slice(0, vehicleCount).map((color, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color.hex }}></div>
                  <span className="text-[10px] text-slate-500">V{i + 1}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Stats */}
        {routeStats && routeStats.mode === 'single' && (
          <div className="p-4 mx-4 mt-3 rounded-xl bg-gradient-to-br from-cyan-900/30 to-blue-900/30 border border-cyan-700/30">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></div>
              <span className="text-xs font-semibold text-cyan-300 uppercase tracking-wider">Optimized Route</span>
            </div>
            <p className="text-3xl font-black text-white">
              {(routeStats.roadDistanceKm || routeStats.totalDistanceKm).toFixed(2)} <span className="text-sm font-normal text-slate-400">km</span>
            </p>
            {routeStats.durationMin && (
              <p className="text-sm font-semibold text-cyan-400 mt-1">🕐 {routeStats.durationMin} min drive</p>
            )}
            <p className="text-xs text-slate-500 mt-1">{routeStats.stops} stops · {routeStats.algorithm}</p>
          </div>
        )}

        {/* Multi-Vehicle Stats */}
        {routeStats && routeStats.mode === 'multi' && vrpResult && (
          <div className="mx-4 mt-3 space-y-2">
            {/* Total summary */}
            <div className="p-4 rounded-xl bg-gradient-to-br from-purple-900/30 to-blue-900/30 border border-purple-700/30">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2 h-2 rounded-full bg-purple-400 animate-pulse"></div>
                <span className="text-xs font-semibold text-purple-300 uppercase tracking-wider">
                  {routeStats.vehicleCount} Vehicle Fleet
                </span>
              </div>
              <p className="text-3xl font-black text-white">
                {(routeStats.roadDistanceKm || routeStats.totalDistanceKm).toFixed(2)} <span className="text-sm font-normal text-slate-400">km total</span>
              </p>
              {routeStats.durationMin && (
                <p className="text-sm font-semibold text-purple-400 mt-1">🕐 ~{Math.max(...vrpDirections.filter(Boolean).map(d => d.durationMin))} min (longest route)</p>
              )}
              <p className="text-xs text-slate-500 mt-1">{routeStats.stops} stops · {routeStats.algorithm}</p>
            </div>

            {/* Per-vehicle cards */}
            {vrpResult.vehicles.map((vehicle, idx) => {
              const color = VEHICLE_COLORS[idx % VEHICLE_COLORS.length];
              const dirData = vrpDirections[idx];
              const isExpanded = expandedVehicle === idx;

              return (
                <div
                  key={idx}
                  className="rounded-xl border transition-all cursor-pointer overflow-hidden"
                  style={{ backgroundColor: color.bg, borderColor: color.border }}
                  onClick={() => setExpandedVehicle(isExpanded ? null : idx)}
                >
                  <div className="p-3 flex items-center gap-3">
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-black text-white shrink-0"
                      style={{ backgroundColor: color.hex }}
                    >
                      V{idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-200">
                        {(dirData?.roadDistanceKm || vehicle.distanceKm).toFixed(2)} km
                        <span className="text-slate-500 font-normal"> · {vehicle.stopCount} stops</span>
                      </p>
                      {dirData?.durationMin && (
                        <p className="text-xs text-slate-400">🕐 {dirData.durationMin} min</p>
                      )}
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleExportToMaps(idx); }}
                      className="p-2 rounded-lg text-xs hover:bg-white/10 transition-colors"
                      style={{ color: color.hex }}
                      title={`Send Vehicle ${idx + 1} route to phone`}
                    >
                      📱
                    </button>
                    <span className="text-slate-500 text-xs">{isExpanded ? '▲' : '▼'}</span>
                  </div>

                  {/* Expanded stop list */}
                  {isExpanded && (
                    <div className="px-3 pb-3 space-y-1">
                      {vehicle.orderedLocations.map((loc, stopIdx) => (
                        <div key={loc._id} className="flex items-center gap-2 py-1 px-2 rounded-md bg-white/5">
                          <div
                            className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                            style={{ backgroundColor: stopIdx === 0 ? '#64748b' : color.hex }}
                          >
                            {stopIdx === 0 ? '🏠' : stopIdx}
                          </div>
                          <span className="text-xs text-slate-300 truncate">{loc.name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Location List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          <div className="flex justify-between items-center mb-2">
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Locations ({locations.length})</h2>
            {locations.length > 0 && (
              <button 
                onClick={handleClearAll}
                className="text-xs text-red-400 hover:text-red-300 transition-colors"
              >
                Clear All
              </button>
            )}
          </div>

          {locations.length === 0 && (
            <div className="text-center py-12">
              <div className="text-4xl mb-3">📍</div>
              <p className="text-sm text-slate-500">No locations added yet.</p>
              <p className="text-xs text-slate-600 mt-1">Click on the map to pin your first stop.</p>
            </div>
          )}

          {locations.map((loc, idx) => {
            const orderNum = getOrderNumber(loc);
            const vIdx = getVehicleForLocation(loc._id);
            const color = vIdx >= 0 ? VEHICLE_COLORS[vIdx % VEHICLE_COLORS.length] : null;
            const depotFlag = isDepot(loc._id);

            return (
              <div
                key={loc._id}
                className="group flex items-center gap-3 p-3 rounded-lg border transition-all cursor-pointer"
                style={{
                  backgroundColor: color ? color.bg : 'rgba(30, 41, 59, 0.5)',
                  borderColor: color ? color.border : 'rgba(51, 65, 85, 0.5)',
                }}
                onClick={() => {
                  setSelectedLocation(loc);
                  if (map) map.panTo({ lat: loc.lat, lng: loc.lng });
                }}
              >
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                  style={{
                    backgroundColor: depotFlag ? '#64748b' : (color ? color.hex : (optimizedRoute ? '#0891b2' : 'rgba(51, 65, 85, 1)')),
                    color: '#ffffff'
                  }}
                >
                  {depotFlag ? '🏠' : orderNum}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-200 truncate">
                    {loc.name}
                    {depotFlag && <span className="text-[10px] ml-1.5 text-slate-500 font-normal">(Depot)</span>}
                    {vIdx >= 0 && !depotFlag && <span className="text-[10px] ml-1.5 font-normal" style={{ color: color.hex }}>V{vIdx + 1}</span>}
                  </p>
                  <p className="text-xs text-slate-500">{loc.lat.toFixed(4)}, {loc.lng.toFixed(4)}</p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteLocation(loc._id); }}
                  className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md hover:bg-red-600/20 text-red-400 transition-all"
                  title="Remove location"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>

        {/* Action Buttons */}
        <div className="p-4 border-t border-slate-800 space-y-3">
          <button
            onClick={handleOptimize}
            disabled={locations.length < 2 || isOptimizing}
            className={`w-full py-3.5 rounded-xl font-semibold text-sm tracking-wide shadow-lg transition-all
              ${locations.length < 2
                ? 'bg-slate-800 text-slate-600 cursor-not-allowed'
                : isOptimizing
                  ? 'bg-cyan-800 text-cyan-300 animate-pulse cursor-wait'
                  : 'bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white shadow-cyan-500/25 hover:shadow-cyan-400/40'
              }`}
          >
            {isOptimizing
              ? 'Optimizing...'
              : vehicleCount > 1
                ? `Optimize for ${vehicleCount} Vehicles ⚡`
                : 'Optimize Route ⚡'
            }
          </button>
          
          <div className="flex gap-2">
            <button
              onClick={clearOptimization}
              disabled={!optimizedRoute && !vrpResult}
              className={`flex-1 py-2.5 rounded-lg text-xs font-medium transition-colors ${
                (optimizedRoute || vrpResult) ? 'bg-slate-800 hover:bg-slate-700 text-slate-400' : 'bg-slate-850 text-slate-700 cursor-not-allowed'
              }`}
            >
              Reset Route
            </button>
            {!isMultiVehicle && (
              <button
                onClick={() => handleExportToMaps()}
                disabled={!optimizedRoute}
                className={`flex-1 flex gap-2 justify-center items-center py-2.5 rounded-lg text-xs font-medium transition-colors ${
                  optimizedRoute ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20' : 'bg-slate-850 text-slate-700 cursor-not-allowed'
                }`}
              >
                📱 Send to Phone
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ─── Map Area ─────────────────────────────────────────── */}
      <div className="flex-1 relative">
        {isLoaded ? (
          <GoogleMap
            mapContainerStyle={mapContainerStyle}
            center={defaultCenter}
            zoom={12}
            onLoad={onLoad}
            onUnmount={onUnmount}
            onClick={handleMapClick}
            mapTypeId="satellite"
            options={{
              disableDefaultUI: false,
              zoomControl: true,
              mapTypeControl: false,
              streetViewControl: false,
              fullscreenControl: true,
            }}
          >
            {/* ── Location Markers ─────────────────────────────── */}
            {(() => {
              if (isMultiVehicle && vrpResult) {
                // Multi-vehicle: render markers per vehicle with colors
                const rendered = new Set();
                const markers = [];

                vrpResult.vehicles.forEach((vehicle, vIdx) => {
                  const color = VEHICLE_COLORS[vIdx % VEHICLE_COLORS.length];
                  vehicle.orderedLocations.forEach((loc, stopIdx) => {
                    if (rendered.has(loc._id)) return; // depot already rendered
                    rendered.add(loc._id);

                    const isDepotMarker = loc._id === vrpResult.depot._id;

                    markers.push(
                      <Marker
                        key={loc._id}
                        position={{ lat: loc.lat, lng: loc.lng }}
                        label={{
                          text: isDepotMarker ? '🏠' : `${stopIdx}`,
                          color: '#ffffff',
                          fontWeight: 'bold',
                          fontSize: isDepotMarker ? '14px' : '11px',
                        }}
                        icon={{
                          path: window.google.maps.SymbolPath.CIRCLE,
                          scale: isDepotMarker ? 18 : 13,
                          fillColor: isDepotMarker ? '#1e293b' : color.hex,
                          fillOpacity: 1,
                          strokeColor: isDepotMarker ? '#94a3b8' : '#ffffff',
                          strokeWeight: isDepotMarker ? 3 : 2,
                          labelOrigin: new window.google.maps.Point(0, 0),
                        }}
                        onClick={() => setSelectedLocation(loc)}
                        zIndex={isDepotMarker ? 999 : 100}
                      />
                    );
                  });
                });

                return markers;
              } else {
                // Single vehicle or no optimization
                const displayLocs = optimizedRoute || locations;
                return displayLocs.map((loc, idx) => (
                  <Marker
                    key={loc._id}
                    position={{ lat: loc.lat, lng: loc.lng }}
                    label={{
                      text: `${idx + 1}`,
                      color: '#ffffff',
                      fontWeight: 'bold',
                      fontSize: '12px',
                    }}
                    icon={optimizedRoute ? {
                      path: window.google.maps.SymbolPath.CIRCLE,
                      scale: 14,
                      fillColor: '#0891b2',
                      fillOpacity: 1,
                      strokeColor: '#ffffff',
                      strokeWeight: 2,
                      labelOrigin: new window.google.maps.Point(0, 0),
                    } : undefined}
                    onClick={() => setSelectedLocation(loc)}
                  />
                ));
              }
            })()}

            {/* ── Single-vehicle directions ────────────────────── */}
            {directionsResult && (
              <DirectionsRenderer
                directions={directionsResult}
                options={{
                  suppressMarkers: true,
                  polylineOptions: {
                    strokeColor: '#06b6d4',
                    strokeOpacity: 0.9,
                    strokeWeight: 5,
                  },
                }}
              />
            )}

            {/* ── Multi-vehicle directions ─────────────────────── */}
            {vrpDirections.map((dirData, idx) => {
              if (!dirData?.directions) return null;
              const color = VEHICLE_COLORS[idx % VEHICLE_COLORS.length];
              return (
                <DirectionsRenderer
                  key={`vrp-dir-${idx}`}
                  directions={dirData.directions}
                  options={{
                    suppressMarkers: true,
                    polylineOptions: {
                      strokeColor: color.hex,
                      strokeOpacity: 0.85,
                      strokeWeight: 5,
                    },
                  }}
                />
              );
            })}

            {/* InfoWindow for selected location */}
            {selectedLocation && (
              <InfoWindow
                position={{ lat: selectedLocation.lat, lng: selectedLocation.lng }}
                onCloseClick={() => setSelectedLocation(null)}
              >
                <div style={{ color: '#1e293b', padding: '4px' }}>
                  <strong style={{ fontSize: '14px' }}>{selectedLocation.name}</strong>
                  <p style={{ fontSize: '11px', marginTop: '4px', color: '#64748b' }}>
                    {selectedLocation.lat.toFixed(5)}, {selectedLocation.lng.toFixed(5)}
                  </p>
                </div>
              </InfoWindow>
            )}
          </GoogleMap>
        ) : (
          <div className="flex items-center justify-center h-full bg-slate-900">
            <div className="text-center">
              <div className="w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
              <p className="text-slate-400">Loading Google Maps...</p>
            </div>
          </div>
        )}

        {/* Vehicle Legend Overlay */}
        {isMultiVehicle && vrpResult && (
          <div className="absolute top-4 right-4 px-4 py-3 rounded-xl bg-slate-900/90 backdrop-blur-md border border-slate-700/80 shadow-2xl">
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-2">Fleet Legend</p>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded-full bg-slate-700 border-2 border-slate-400 flex items-center justify-center text-[8px]">🏠</div>
                <span className="text-xs text-slate-300">Depot</span>
              </div>
              {vrpResult.vehicles.map((_, idx) => {
                const color = VEHICLE_COLORS[idx % VEHICLE_COLORS.length];
                return (
                  <div key={idx} className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-full" style={{ backgroundColor: color.hex }}></div>
                    <span className="text-xs text-slate-300">Vehicle {idx + 1} <span className="text-slate-500">({color.name})</span></span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Map overlay instruction */}
        {isLoaded && locations.length === 0 && (
          <div className="absolute top-6 left-1/2 -translate-x-1/2 px-6 py-3 rounded-full bg-slate-900/80 backdrop-blur-md border border-slate-700 shadow-2xl">
            <p className="text-sm text-slate-300 flex items-center gap-2">
              <span className="text-lg">👆</span> Click anywhere on the map to add a location
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
