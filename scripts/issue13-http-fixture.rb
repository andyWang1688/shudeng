# Original test book material only. Never record headers or credentials.
require 'socket'
require 'json'
STDOUT.sync = true
server = TCPServer.new('127.0.0.1', 18773)
requests = []
lock = Mutex.new
puts 'READY issue13'
loop do
  client = server.accept
  Thread.new(client) do |socket|
    begin
      method, path, = socket.gets.to_s.split
      headers = {}
      while (line = socket.gets) && line != "\r\n"
        k, v = line.split(':', 2); headers[k.downcase] = v.to_s.strip
      end
      if method == 'GET' && path == '/requests'
        response = lock.synchronize { requests.dup }
      else
        body = JSON.parse(socket.read(headers.fetch('content-length', '0').to_i))
        prompt = body.dig('messages', 0, 'content')
        check = prompt == 'Reply OK.'
        material = begin JSON.parse(prompt.split("\n", 2).last); rescue JSON::ParserError; nil; end unless check
        resolve = body['max_tokens'] == 600
        unless check
          row = {path: path, model: body['model'], max_tokens: body['max_tokens'], prompt: prompt, material: material}
          lock.synchronize { requests << row }
          puts JSON.generate(row)
        end
        evidence = material.to_h.fetch('evidence', [])
        answer = material.to_h['question'].to_s.start_with?('I13-FULL') ? '后文说明：第七日发生电池漏液，事故后作者修订了停机规则。' : '仅依据本次实际材料解释。'
        reply = resolve ? {queries: ['余辉延迟是什么？', '危险停机的原因和修订是什么？']} : {answer: answer, citations: evidence.map { |e| e.slice('id', 'quote') }}
        content = check ? 'OK' : JSON.generate(reply)
        response = path.end_with?('/chat/completions') ? {choices: [{message: {content: content}, finish_reason: 'stop'}]} : {content: [{type: 'text', text: content}], stop_reason: 'end_turn'}
      end
      payload = JSON.generate(response)
      socket.write("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: #{payload.bytesize}\r\nConnection: close\r\n\r\n#{payload}")
    rescue Errno::EPIPE, Errno::ECONNRESET
      puts JSON.generate(cancelled_connection: true)
    rescue => e
      puts JSON.generate(fixture_error: e.class.name)
    ensure
      socket.close
    end
  end
end
