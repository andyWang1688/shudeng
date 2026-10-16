# Controlled original fixture data only; headers and credentials are never logged.
require 'socket'
require 'json'
STDOUT.sync = true
server = TCPServer.new('127.0.0.1', 18772)
puts 'READY issue12'
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
      question = material.fetch('question', '')
      queries = if question.include?('改口')
        ['初版规则为什么要求等待次日停机复核？', '作者为什么修订停机规则，发生了什么事故？']
      elsif question.include?('记录器')
        ['切断主供电后记录器和计时器为什么继续运行？', '危险停机时为什么应切断主供电而不是只发送停机指令？']
      else
        ['余辉延迟是什么，危险停机应该怎么办？']
      end
      code = body['model'] == 'capacity' ? 413 : 200
      puts JSON.generate(path: path, model: body['model'], max_tokens: body['max_tokens'], status: code, material: material) unless check
      sleep 2 if body['model'] == 'slow'
      evidence = material.fetch('evidence', [])
      reply = resolve ? {queries: queries} : {answer: question + '：依据本次提供的原文核查。', citations: evidence.map { |e| e.slice('id', 'quote') }}
      content = check ? 'OK' : JSON.generate(reply)
      response = path.end_with?('/chat/completions') ? {choices: [{message: {content: content}, finish_reason: 'stop'}]} : {content: [{type: 'text', text: content}], stop_reason: 'end_turn'}
      response = {error: {code: 'context_length_exceeded'}} if code != 200
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
