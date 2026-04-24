import os
import datetime
from flask import Flask, request, jsonify
from flask_cors import CORS
from pymongo import MongoClient
from pymongo.errors import ConnectionFailure
from bson import ObjectId
from dotenv import load_dotenv

# Import algorithms
from algorithms.tsp import TSPSolver
from algorithms.vrp import VRPSolver

load_dotenv()

app = Flask(__name__)
CORS(app)

MONGO_URI = os.getenv('MONGODB_URI', 'mongodb://127.0.0.1:27017/route_optimization')
client = MongoClient(MONGO_URI)
try:
    client.admin.command('ping')
    print("Connected to MongoDB successfully")
except ConnectionFailure as e:
    print(f"MongoDB connection error: {e}")

db = client.get_database()
locations_col = db['locations']

def doc_to_dict(doc):
    doc['_id'] = str(doc['_id'])
    # Optional: convert datetime to ISO string if needed by frontend, though JS might handle string format
    if 'createdAt' in doc and isinstance(doc['createdAt'], datetime.datetime):
        doc['createdAt'] = doc['createdAt'].isoformat()
    return doc

@app.route('/', methods=['GET'])
def health_check():
    return jsonify({"status": "Route Optimization API is running (Python/Flask)"})

@app.route('/api/locations', methods=['GET'])
def get_locations():
    try:
        locations = list(locations_col.find().sort("createdAt", 1))
        return jsonify([doc_to_dict(loc) for loc in locations])
    except Exception as e:
        print(e)
        return jsonify({"error": "Server Error"}), 500

@app.route('/api/locations', methods=['POST'])
def add_location():
    try:
        data = request.json
        new_loc = {
            "name": data.get("name", "Unnamed Location"),
            "lat": float(data["lat"]),
            "lng": float(data["lng"]),
            "createdAt": datetime.datetime.utcnow()
        }
        result = locations_col.insert_one(new_loc)
        new_loc['_id'] = str(result.inserted_id)
        if 'createdAt' in new_loc and isinstance(new_loc['createdAt'], datetime.datetime):
            new_loc['createdAt'] = new_loc['createdAt'].isoformat()
        return jsonify(new_loc)
    except Exception as e:
        print(e)
        return jsonify({"error": "Server Error"}), 500

@app.route('/api/locations/<id>', methods=['DELETE'])
def delete_location(id):
    try:
        locations_col.delete_one({"_id": ObjectId(id)})
        return jsonify({"msg": "Location removed"})
    except Exception as e:
        print(e)
        return jsonify({"error": "Server Error"}), 500

@app.route('/api/locations', methods=['DELETE'])
def clear_locations():
    try:
        locations_col.delete_many({})
        return jsonify({"msg": "All locations cleared"})
    except Exception as e:
        print(e)
        return jsonify({"error": "Server Error"}), 500

@app.route('/api/locations/optimize', methods=['POST'])
def optimize_tsp():
    try:
        locations = list(locations_col.find().sort("createdAt", 1))
        if len(locations) < 2:
            return jsonify({"error": "Need at least 2 locations to optimize a route."}), 400

        solver_input = [{'lat': l['lat'], 'lng': l['lng']} for l in locations]
        solver = TSPSolver(solver_input)
        result = solver.solve()

        ordered_locations = [doc_to_dict(locations[idx]) for idx in result['path']]

        return jsonify({
            "success": True,
            "totalDistanceKm": result['totalDistanceKm'],
            "orderedLocations": ordered_locations,
            "algorithm": "Nearest Neighbor" if len(locations) <= 3 else "Genetic Algorithm + 2-Opt"
        })
    except Exception as e:
        print(e)
        return jsonify({"error": str(e)}), 500

@app.route('/api/locations/optimize-vrp', methods=['POST'])
def optimize_vrp():
    try:
        data = request.json or {}
        vehicle_count = int(data.get("vehicleCount", 2))
        
        locations = list(locations_col.find().sort("createdAt", 1))
        if len(locations) < 2:
            return jsonify({"error": "Need at least 2 locations to optimize a route."}), 400
            
        if vehicle_count < 1 or vehicle_count > 10:
            return jsonify({"error": "Vehicle count must be between 1 and 10."}), 400

        effective_vehicles = min(vehicle_count, len(locations) - 1)
        solver_input = [{'lat': l['lat'], 'lng': l['lng']} for l in locations]
        solver = VRPSolver(solver_input, effective_vehicles)
        result = solver.solve()

        vehicles = []
        for v in result['vehicles']:
            vehicles.append({
                "vehicleId": v['vehicleId'],
                "orderedLocations": [doc_to_dict(locations[idx]) for idx in v['originalIndices']],
                "distanceKm": v['totalDistanceKm'],
                "stopCount": len(v['originalIndices'])
            })

        return jsonify({
            "success": True,
            "vehicleCount": effective_vehicles,
            "depot": doc_to_dict(locations[0]),
            "vehicles": vehicles,
            "totalDistanceKm": result['totalDistanceKm'],
            "algorithm": "K-Means Clustering + Genetic Algorithm + 2-Opt"
        })
    except Exception as e:
        print(e)
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=port, debug=True)
