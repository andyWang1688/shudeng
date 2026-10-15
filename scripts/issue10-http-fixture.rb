# One controlled OpenAI-format response for the original semantic EPUB. No headers logged.
require "socket"
require "json"
server = TCPServer.new("127.0.0.1", 18770)
STDOUT.sync = true
puts "READY issue10"
target = "每座站的温度仪由主电池供电，计时器和记录器则接在独立的备用电池上。主供电切断后，后两者继续工作，温度仪停止。"
loop do
  socket = server.accept
  begin
    method, path, = socket.gets.to_s.split
    headers = {}
    while (line = socket.gets) && line != "\r\n"
      key, value = line.split(":", 2); headers[key.downcase] = value.to_s.strip
    end
    body = JSON.parse(socket.read(headers.fetch("content-length", "0").to_i))
    prompt = body.dig("messages", 0, "content")
    material = JSON.parse(prompt.split("\n", 2).last)
    evidence = material.fetch("evidence")
    reference = evidence.find { |item| item["quote"] == target }
    valid = method == "POST" && path == "/v1/chat/completions" && headers["authorization"] == "Bearer not-a-real-credential" &&
      body["model"] == "semantic-background" && body["stream"] == false && body["max_tokens"] == 1600 && reference
    puts JSON.generate(contract_valid: !!valid, prompt_bytes: prompt.bytesize, material: material)
    raise "Missing semantic background" unless valid
    reply = {answer: "计时器和记录器依靠独立备用电池继续工作。", citations: [reference.slice("id", "quote")]}
    payload = JSON.generate(choices: [{message: {content: JSON.generate(reply)}, finish_reason: "stop"}])
    socket.write("HTTP/1.1 200 Fixture\r\nContent-Type: application/json\r\nContent-Length: #{payload.bytesize}\r\nConnection: close\r\n\r\n#{payload}")
  ensure
    socket.close
  end
end
