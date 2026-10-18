# Only synthetic questions and the repository's original EPUB fixtures.
require 'socket'
require 'json'
STDOUT.sync = true
server = TCPServer.new('127.0.0.1', 18777)
puts 'READY issue17'
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
      prompt = body.dig('messages', 0, 'content')
      check = prompt == 'Reply OK.'
      material = check ? {} : JSON.parse(prompt.split("\n", 2).last)
      resolve = body['max_tokens'] == 600
      puts JSON.generate(time: Time.now.to_f, event: 'request', path: path, model: body['model'], max_tokens: body['max_tokens'], material: material) unless check
      evidence = material.fetch('evidence', [])
      sleep 2 if !resolve && material.fetch('question', '').include?('-follow')
      target = evidence.find { |e| e['quote'].start_with?('每座站的温度仪由主电池供电') }
      reply = resolve ? {queries: ['切断主供电后记录器和计时器为什么继续工作？']} : {answer: '受控组合回答：记录器和计时器使用备用电池。', citations: target ? [target.slice('id', 'quote')] : []}
      content = check ? 'OK' : JSON.generate(reply)
      response = path.end_with?('/chat/completions') ? {choices: [{message: {content: content}, finish_reason: 'stop'}]} : {content: [{type: 'text', text: content}], stop_reason: 'end_turn'}
      payload = JSON.generate(response)
      socket.write("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: #{payload.bytesize}\r\nConnection: close\r\n\r\n#{payload}")
      puts JSON.generate(time: Time.now.to_f, event: 'response', conversationID: material['conversationID'], turnID: material['turnID'], resolve: resolve, citations: reply[:citations]) unless check
    rescue Errno::EPIPE, Errno::ECONNRESET
      puts JSON.generate(event: 'cancelled_connection')
    rescue => e
      puts JSON.generate(fixture_error: e.class.name)
    ensure
      socket.close
    end
  end
end
