from fastapi import FastAPI
from pydantic import BaseModel
from typing import List, Optional
import networkx as nx

app = FastAPI(title="Taxi Routing Engine")

class Node(BaseModel):
    id: str
    name: str
    lat: float
    lng: float

class Edge(BaseModel):
    id: str
    from_rank_id: str
    to_rank_id: str
    fare: float
    time_mins: int
    taxi_association: Optional[str] = "Independent"

class RoutingRequest(BaseModel):
    nodes: List[Node]
    edges: List[Edge]
    from_rank_id: str
    to_rank_id: str
    priority: str = "cheapest"

@app.post("/calculate_route")
def calculate_route(payload: RoutingRequest):
    G = nx.DiGraph()

    for n in payload.nodes:
        G.add_node(n.id, name=n.name, lat=n.lat, lng=n.lng)

    for e in payload.edges:
        if e.from_rank_id in G and e.to_rank_id in G:
            G.add_edge(
                e.from_rank_id,
                e.to_rank_id,
                id=e.id,
                fare=e.fare,
                time_mins=e.time_mins,
                taxi_association=e.taxi_association
            )

    if payload.from_rank_id not in G or payload.to_rank_id not in G:
        return {"error": "Origin or destination rank not found in graph."}

    # Map request priority to edge attribute
    weight_map = {
        "cheapest": "fare",
        "fastest": "time_mins",
        "easiest": None,  # Fewest transfers
        "safest": "fare"
    }
    weight_attr = weight_map.get(payload.priority, "fare")

    try:
        path = nx.shortest_path(G, source=payload.from_rank_id, target=payload.to_rank_id, weight=weight_attr)
    except (nx.NetworkXNoPath, nx.NodeNotFound):
        return {"error": "No route available between the specified ranks."}

    legs = []
    total_fare = 0.0
    total_time = 0

    for i in range(len(path) - 1):
        u, v = path[i], path[i + 1]
        edge = G.get_edge_data(u, v)
        u_node = G.nodes[u]
        v_node = G.nodes[v]

        legs.append({
            "from_rank": {"id": u, "name": u_node["name"], "lat": u_node["lat"], "lng": u_node["lng"]},
            "to_rank": {"id": v, "name": v_node["name"], "lat": v_node["lat"], "lng": v_node["lng"]},
            "fare": edge["fare"],
            "time_mins": edge["time_mins"],
            "taxi_association": edge["taxi_association"]
        })
        total_fare += edge["fare"]
        total_time += edge["time_mins"]

    return {
        "total_fare": round(total_fare, 2),
        "total_time_mins": total_time,
        "legs": legs
    }