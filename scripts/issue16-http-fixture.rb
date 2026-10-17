# Controlled local removal races; synthetic material only, never logs credentials.
require 'socket'
require 'json'
STDOUT.sync = true
server = TCPServer.new('127.0.0.1', 18776)
puts JSON.generate(event: 'ready', time: Time.now.to_f)
loop do
  Thread.new(server.accept) do |socket|
    begin
      _, path, = socket.gets.split
      headers = {}
      while (line = socket.gets) && line != "\r\n"
        key, value = line.split(':', 2); headers[key.downcase] = value.strip
      end
      body = JSON.parse(socket.read(headers.fetch('content-length').to_i))
      material = JSON.parse(body.fetch('messages')[0].fetch('content').split("\n", 2).last)
      marker = material.fetch('question')
      puts JSON.generate(event: 'request', time: Time.now.to_f, path: path, marker: marker, material: material)
      sleep 2
      content = JSON.generate(answer: "Saved #{marker}", citations: material.fetch('evidence').map { |e| e.slice('id', 'quote') })
      response = JSON.generate(choices: [{message: {content: content}, finish_reason: 'stop'}])
      socket.write("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: #{response.bytesize}\r\nConnection: close\r\n\r\n#{response}")
      puts JSON.generate(event: 'response', time: Time.now.to_f, marker: marker)
    rescue Errno::EPIPE, Errno::ECONNRESET
      puts JSON.generate(event: 'cancelled-connection', time: Time.now.to_f)
    rescue => error
      puts JSON.generate(event: 'error', error: error.class.name)
    ensure
      socket.close
    end
  end
end
