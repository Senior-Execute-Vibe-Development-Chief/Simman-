use wasm_bindgen::prelude::*;

/// M0's sole WASM proof: deterministic Dijkstra on a fixed smoke-test graph.
/// The routing engine and terrain interface are intentionally M1 work.
#[wasm_bindgen]
pub fn dijkstra_test_graph() -> Vec<f64> {
    const INFINITY: f64 = 1.0e300;
    const NODE_COUNT: usize = 5;
    let graph: [[f64; NODE_COUNT]; NODE_COUNT] = [
        [0.0, 2.0, 5.0, INFINITY, INFINITY],
        [2.0, 0.0, 1.0, 4.0, INFINITY],
        [5.0, 1.0, 0.0, 1.0, 6.0],
        [INFINITY, 4.0, 1.0, 0.0, 2.0],
        [INFINITY, INFINITY, 6.0, 2.0, 0.0],
    ];
    let mut distances = [INFINITY; NODE_COUNT];
    let mut visited = [false; NODE_COUNT];
    distances[0] = 0.0;

    for _ in 0..NODE_COUNT {
        let mut next = None;
        for node in 0..NODE_COUNT {
            if !visited[node] && next.is_none_or(|current| distances[node] < distances[current]) {
                next = Some(node);
            }
        }
        let Some(node) = next else { break };
        visited[node] = true;
        for neighbor in 0..NODE_COUNT {
            let candidate = distances[node] + graph[node][neighbor];
            if candidate < distances[neighbor] {
                distances[neighbor] = candidate;
            }
        }
    }
    distances.to_vec()
}
