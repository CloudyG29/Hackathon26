from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import networkx as nx

app = FastAPI(title="Routing Engine Microservice")

# --- Pydantic Models ---
class CalculateRouteRequest(BaseModel):
    nodes: List[Dict[str, Any]]
    edges: List[Dict[str, Any]]
    from_rank_id: str
    to_rank_id: str
    priority: str = "cheapest"

# --- Main Endpoint ---
@app.post("/calculate_route")
async def calculate_route(req: CalculateRouteRequest):
    # 1. Initialize an empty Directed Graph
    G = nx.DiGraph()

    # 2. Add all ranks (nodes) to the graph
    for node in req.nodes:
        G.add_node(
            node["id"], 
            name=node["name"], 
            lat=node["lat"], 
            lng=node["lng"]
        )

    # 3. Add all unblocked routes (edges) to the graph
    for edge in req.edges:
        # Only add edge if both source and target nodes exist
        if edge["from_rank_id"] in G and edge["to_rank_id"] in G:
            G.add_edge(
                edge["from_rank_id"],
                edge["to_rank_id"],
                id=edge["id"],
                fare=float(edge["fare"]),
                time_mins=int(edge["time_mins"]),
                taxi_association=edge["taxi_association"]
            )

    # 4. Check if Origin and Destination exist in the graph
    if req.from_rank_id not in G or req.to_rank_id not in G:
        return {
            "error": "Origin or destination rank does not exist in the active network.",
            "legs": []
        }

    # 5. Determine the weight attribute for Dijkstra's algorithm
    weight_map = {
        "cheapest": "fare",
        "fastest": "time_mins",
        "easiest": None, # Unweighted finds fewest transfers
        "safest": None   # Same as easiest for now, can be updated later
    }
    weight_attr = weight_map.get(req.priority, "fare")

    # 6. Calculate Shortest Path
    try:
        path = nx.shortest_path(
            G, 
            source=req.from_rank_id, 
            target=req.to_rank_id, 
            weight=weight_attr
        )
    except nx.NetworkXNoPath:
        return {
            "error": "No viable route exists between these ranks due to strikes or missing links.",
            "legs": []
        }

    # 7. Construct the response payload
    legs = []
    total_fare = 0.0
    total_time = 0

    for i in range(len(path) - 1):
        u, v = path[i], path[i + 1]
        edge_data = G.get_edge_data(u, v)
        u_node = G.nodes[u]
        v_node = G.nodes[v]

        leg = {
            "from_rank": {
                "id": u,
                "name": u_node.get("name", u),
                "lat": u_node.get("lat"),
                "lng": u_node.get("lng")
            },
            "to_rank": {
                "id": v,
                "name": v_node.get("name", v),
                "lat": v_node.get("lat"),
                "lng": v_node.get("lng")
            },
            "fare": edge_data["fare"],
            "time_mins": edge_data["time_mins"],
            "taxi_association": edge_data["taxi_association"]
        }
        legs.append(leg)
        total_fare += edge_data["fare"]
        total_time += edge_data["time_mins"]

    return {
        "total_fare": round(total_fare, 2),
        "total_time_mins": total_time,
        "legs": legs
    }