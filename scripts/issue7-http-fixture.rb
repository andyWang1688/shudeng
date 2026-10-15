# Local, controlled HTTP fixture. Never logs credentials or response bodies.
require 'socket'
require 'json'
port = Integer(ARGV.fetch(0, '18767'))
server = TCPServer.new('127.0.0.1', port)
STDOUT.sync = true
puts "READY port=#{port}"
loop do
  socket = server.accept
  Thread.new(socket) do |client|
    begin
      method, path, = client.gets.to_s.split
      headers = {}
      while (line = client.gets) && line != "\r\n"
        k, v = line.split(':', 2)
        headers[k.downcase] = v.to_s.strip
      end
      body = JSON.parse(client.read(headers.fetch('content-length', '0').to_i))
      format = path.end_with?('/chat/completions') ? 'OpenAI' : 'Anthropic'
      valid = method == 'POST' && ['/v1/chat/completions', '/v1/messages', '/gateway/v1/chat/completions'].include?(path) &&
        body.keys.sort == %w[max_tokens messages model stream] && body['stream'] == false && body['max_tokens'] == 16 &&
        body['messages'] == [{'role'=>'user', 'content'=>'Reply OK.'}] &&
        headers['content-type'] == 'application/json' &&
        (format == 'OpenAI' ? headers['authorization'] == 'Bearer not-a-real-credential' && !headers.key?('x-api-key') :
          headers['x-api-key'] == 'not-a-real-credential' && headers['anthropic-version'] == '2023-06-01' && !headers.key?('authorization'))
      model = body['model']
      code = valid ? {'auth'=>401, 'forbidden'=>403, 'missing-model'=>404, 'bad-model'=>400, 'limited'=>429, 'unavailable'=>503, 'redirect'=>307}.fetch(model, 200) : 422
      response = if model == 'malformed'
        {'unexpected'=>'shape'}
      elsif model == 'empty'
        format == 'OpenAI' ? {'choices'=>[{'message'=>{'content'=>''}}]} : {'content'=>[{'type'=>'tool_use', 'id'=>'ignored'}]}
      elsif format == 'OpenAI'
        {'choices'=>[{'message'=>{'role'=>'assistant','content'=>'OK'}, 'finish_reason'=>'stop'}]}
      else
        {'content'=>[{'type'=>'text','text'=>'OK'}], 'stop_reason'=>'end_turn'}
      end
      # Error fixtures deliberately echo a secret; the app must never display it.
      response = {'error'=>{'message'=>headers['authorization'] || headers['x-api-key']}} if code >= 400
      payload = JSON.generate(response)
      location = code == 307 ? "Location: http://127.0.0.1:18767/stolen\r\n" : ''
      client.write("HTTP/1.1 #{code} Fixture\r\nContent-Type: application/json\r\n#{location}Content-Length: #{payload.bytesize}\r\nConnection: close\r\n\r\n#{payload}")
      puts JSON.generate(format: format, path: path, model: model, contract_valid: valid, status: code)
    rescue => e
      puts JSON.generate(fixture_error: e.class.name)
    ensure
      client.close
    end
  end
end
