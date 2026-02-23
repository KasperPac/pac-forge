using System;
using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace PacForgeBridge
{
    public class WebSocketHandler
    {
        private readonly ConcurrentDictionary<string, WebSocket> _clients
            = new ConcurrentDictionary<string, WebSocket>();

        public int ClientCount => _clients.Count;

        public async Task AcceptClient(WebSocket socket)
        {
            string clientId = Guid.NewGuid().ToString("N").Substring(0, 8);
            _clients.TryAdd(clientId, socket);
            Console.WriteLine($"[WS] Client connected: {clientId} (total: {_clients.Count})");

            try
            {
                // Keep connection alive by reading (we only send, but must read to detect close)
                var buffer = new byte[1024];
                while (socket.State == WebSocketState.Open)
                {
                    var result = await socket.ReceiveAsync(
                        new ArraySegment<byte>(buffer), CancellationToken.None);

                    if (result.MessageType == WebSocketMessageType.Close)
                    {
                        await socket.CloseAsync(
                            WebSocketCloseStatus.NormalClosure, "Client disconnected",
                            CancellationToken.None);
                        break;
                    }
                }
            }
            catch (WebSocketException)
            {
                // Client disconnected abruptly
            }
            finally
            {
                _clients.TryRemove(clientId, out _);
                Console.WriteLine($"[WS] Client disconnected: {clientId} (total: {_clients.Count})");
            }
        }

        public async Task Broadcast(BridgeEvent bridgeEvent)
        {
            if (_clients.IsEmpty) return;

            string json = Json.Serialize(bridgeEvent);
            var bytes = Encoding.UTF8.GetBytes(json);
            var segment = new ArraySegment<byte>(bytes);

            foreach (var kvp in _clients)
            {
                try
                {
                    if (kvp.Value.State == WebSocketState.Open)
                    {
                        await kvp.Value.SendAsync(
                            segment, WebSocketMessageType.Text, true, CancellationToken.None);
                    }
                }
                catch (WebSocketException)
                {
                    // Client gone, will be cleaned up on next receive
                    _clients.TryRemove(kvp.Key, out _);
                }
            }
        }

        public async Task CloseAll()
        {
            foreach (var kvp in _clients)
            {
                try
                {
                    if (kvp.Value.State == WebSocketState.Open)
                    {
                        await kvp.Value.CloseAsync(
                            WebSocketCloseStatus.EndpointUnavailable, "Bridge shutting down",
                            CancellationToken.None);
                    }
                }
                catch { }
            }
            _clients.Clear();
        }
    }
}
