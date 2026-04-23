const express = require('express');
const router = express.Router();
const Location = require('../models/Location');
const TSPSolver = require('../algorithms/tsp');
const VRPSolver = require('../algorithms/vrp');

// @route   GET /api/locations
// @desc    Get all saved locations
router.get('/', async (req, res) => {
  try {
    const locations = await Location.find().sort({ createdAt: 1 });
    res.json(locations);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Server Error' });
  }
});

// @route   POST /api/locations
// @desc    Add a new location
router.post('/', async (req, res) => {
  try {
    const { name, lat, lng } = req.body;
    const location = new Location({ name, lat, lng });
    await location.save();
    res.json(location);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Server Error' });
  }
});

// @route   DELETE /api/locations/:id
// @desc    Remove a single location
router.delete('/:id', async (req, res) => {
  try {
    await Location.findByIdAndDelete(req.params.id);
    res.json({ msg: 'Location removed' });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Server Error' });
  }
});

// @route   DELETE /api/locations
// @desc    Clear all locations
router.delete('/', async (req, res) => {
  try {
    await Location.deleteMany({});
    res.json({ msg: 'All locations cleared' });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Server Error' });
  }
});

// @route   POST /api/optimize
// @desc    Run TSP optimization on all saved locations (single vehicle)
router.post('/optimize', async (req, res) => {
  try {
    const locations = await Location.find().sort({ createdAt: 1 });

    if (locations.length < 2) {
      return res.status(400).json({ error: 'Need at least 2 locations to optimize a route.' });
    }

    const solver = new TSPSolver(locations.map(l => ({ lat: l.lat, lng: l.lng })));
    const result = solver.solve();

    // Map indices back to actual location documents
    const orderedLocations = result.path.map(idx => locations[idx]);

    res.json({
      success: true,
      totalDistanceKm: result.totalDistanceKm,
      orderedLocations,
      algorithm: locations.length <= 3 ? 'Nearest Neighbor' : 'Genetic Algorithm + 2-Opt'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// @route   POST /api/optimize-vrp
// @desc    Run VRP optimization — split locations across multiple vehicles
router.post('/optimize-vrp', async (req, res) => {
  try {
    const { vehicleCount = 2 } = req.body;
    const locations = await Location.find().sort({ createdAt: 1 });

    if (locations.length < 2) {
      return res.status(400).json({ error: 'Need at least 2 locations to optimize a route.' });
    }

    if (vehicleCount < 1 || vehicleCount > 10) {
      return res.status(400).json({ error: 'Vehicle count must be between 1 and 10.' });
    }

    const effectiveVehicles = Math.min(vehicleCount, locations.length - 1);

    const solver = new VRPSolver(
      locations.map(l => ({ lat: l.lat, lng: l.lng })),
      effectiveVehicles
    );
    const result = solver.solve();

    // Map indices back to actual location documents
    const vehicles = result.vehicles.map(v => ({
      vehicleId: v.vehicleId,
      orderedLocations: v.originalIndices.map(idx => locations[idx]),
      distanceKm: v.totalDistanceKm,
      stopCount: v.originalIndices.length
    }));

    res.json({
      success: true,
      vehicleCount: effectiveVehicles,
      depot: locations[0],
      vehicles,
      totalDistanceKm: result.totalDistanceKm,
      algorithm: 'K-Means Clustering + Genetic Algorithm + 2-Opt'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
