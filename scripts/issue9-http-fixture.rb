# Controlled, original text only. Never prints request headers or credentials.
require 'socket'
require 'json'
server = TCPServer.new('127.0.0.1', Integer(ARGV.fetch(0, '18769')))
STDOUT.sync = true
puts 'READY issue9'
loop do
  client = server.accept
  Thread.new(client) do |socket|
    begin
      method, path, = socket.gets.to_s.split
      headers = {}
      while (line = socket.gets) && line != "\r\n"
        k, v = line.split(':', 2); headers[k.downcase] = v.to_s.strip
      end
      body = JSON.parse(socket.read(headers.fetch('content-length', '0').to_i))
      format = path.end_with?('/chat/completions') ? 'OpenAI' : 'Anthropic'
      prompt = body.dig('messages', 0, 'content')
      check = prompt == 'Reply OK.'
      valid = method == 'POST' && ['/v1/chat/completions', '/v1/messages'].include?(path) && body.keys.sort == %w[max_tokens messages model stream] && body['stream'] == false &&
        body['max_tokens'] == (check ? 16 : 1600) && body['messages'].length == 1 && body.dig('messages', 0, 'role') == 'user' &&
        (format == 'OpenAI' ? headers['authorization'] == 'Bearer not-a-real-credential' : headers['x-api-key'] == 'not-a-real-credential' && headers['anthropic-version'] == '2023-06-01')
      material = check ? {} : JSON.parse(prompt.split("\n", 2).last)
      code = !valid ? 422 : body['model'] == 'network-failure' ? 503 : 200
      if !check
        # Only generated fixture books and synthetic questions are used by this server.
        puts JSON.generate(format: format, path: path, model: body['model'], contract_valid: valid, status: code, material: material)
      end
      sleep(body['model'] == 'late' ? 3 : body['model'] == 'slow' ? 8 : 0) unless check
      evidence = material.fetch('evidence', [])
      reply = {'answer'=>'依据原文解释选文；一般解释和推断需与书内依据区分。', 'citations'=>[]}
      unless evidence.empty? || body['model'] == 'no-evidence'
        reply['citations'] = evidence.first(2).map { |e| e.slice('id', 'quote') } + [{'id'=>'E999','quote'=>'invented source'}, {'id'=>evidence.first['id'], 'quote'=>'wrong quotation'}]
        if body['model'] == 'jump-second'
          target = evidence.find { |e| e['quote'].downcase == 'sentence' && e['context'].include?('S1-SECOND') }
          reply['citations'] = target ? [target.slice('id', 'quote')] : [{'id'=>'E999','quote'=>'missing second occurrence'}]
        end
      end
      content = check ? 'OK' : JSON.generate(reply)
      response = format == 'OpenAI' ? {'choices'=>[{'message'=>{'content'=>content},'finish_reason'=>'stop'}]} : {'content'=>[{'type'=>'text','text'=>content}],'stop_reason'=>'end_turn'}
      if body['model'] == 'truncated'
        format == 'OpenAI' ? response['choices'][0]['finish_reason'] = 'length' : response['stop_reason'] = 'max_tokens'
      end
      response = {'error'=>{'message'=>'fixture unavailable'}} if code != 200
      payload = JSON.generate(response)
      socket.write("HTTP/1.1 #{code} Fixture\r\nContent-Type: application/json\r\nContent-Length: #{payload.bytesize}\r\nConnection: close\r\n\r\n#{payload}")
    rescue Errno::EPIPE, Errno::ECONNRESET
      puts JSON.generate(cancelled_connection: true)
    rescue => e
      puts JSON.generate(fixture_error: e.class.name)
    ensure
      socket.close
    end
  end
end
