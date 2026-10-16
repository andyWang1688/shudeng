# Non-streaming fixture. Logs synthetic material/times, never headers or keys.
require 'socket'
require 'json'
server = TCPServer.new('127.0.0.1', 18774)
STDOUT.sync = true
puts 'READY issue14'
loop do
  socket = server.accept
  Thread.new(socket) do |client|
    begin
      method, path, = client.gets.split
      headers = {}
      while (line = client.gets) && line != "\r\n"
        k, v = line.split(':', 2); headers[k.downcase] = v.to_s.strip
      end
      body = JSON.parse(client.read(headers.fetch('content-length').to_i))
      format = path.end_with?('/chat/completions') ? 'OpenAI' : 'Anthropic'
      valid = method == 'POST' && %w[/v1/chat/completions /v1/messages].include?(path) && body['stream'] == false && body['max_tokens'] == 1600
      raise 'Invalid fixture contract' unless valid
      material = JSON.parse(body.dig('messages',0,'content').split("\n",2).last)
      model = body.fetch('model'); delay = model.start_with?('bg-') ? Integer(model.delete_prefix('bg-')) : 2
      puts JSON.generate(event:'request', time:Time.now.to_f, format:format, model:model, material:material)
      sleep delay
      next if model == 'disconnect'
      reply = {answer:"BG14-#{format}-#{delay}",citations:material.fetch('evidence').first(1).map { |e| e.slice('id','quote') }}
      text = JSON.generate(reply)
      response = format == 'OpenAI' ? {choices:[{message:{content:text},finish_reason:'stop'}]} : {content:[{type:'text',text:text}],stop_reason:'end_turn'}
      payload = JSON.generate(response)
      puts JSON.generate(event:'response', time:Time.now.to_f, format:format, model:model, response:response)
      client.write("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: #{payload.bytesize}\r\nConnection: close\r\n\r\n#{payload}")
    rescue Errno::EPIPE, Errno::ECONNRESET
      puts JSON.generate(event:'cancelledConnection', time:Time.now.to_f)
    rescue => e
      puts JSON.generate(event:'error', error:e.class.name, time:Time.now.to_f)
    ensure
      client.close
    end
  end
end
