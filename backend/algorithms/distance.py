import math

def haversine_distance(a, b):
    def to_rad(x):
        return (x * math.pi) / 180.0
    R = 6371  # Earth radius in km

    d_lat = to_rad(b['lat'] - a['lat'])
    d_lng = to_rad(b['lng'] - a['lng'])

    sin_d_lat = math.sin(d_lat / 2.0)
    sin_d_lng = math.sin(d_lng / 2.0)

    calc = (
        sin_d_lat * sin_d_lat +
        math.cos(to_rad(a['lat'])) * math.cos(to_rad(b['lat'])) * sin_d_lng * sin_d_lng
    )

    return R * 2.0 * math.atan2(math.sqrt(calc), math.sqrt(1.0 - calc))

def build_distance_matrix(locations):
    n = len(locations)
    matrix = [[0.0] * n for _ in range(n)]

    for i in range(n):
        for j in range(i + 1, n):
            d = haversine_distance(locations[i], locations[j])
            matrix[i][j] = d
            matrix[j][i] = d

    return matrix
