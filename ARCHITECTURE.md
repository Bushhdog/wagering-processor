## Escopo implementado e o que ficou de fora (SQS, outbox, REFUND/ROLLBACK, autenticação, observabilidade completa)
Escopo implementado: Integração do POSTGRES com o DOCKER, criação de Wallets com player_id e currency, criação de migrations com up e down para reversões, criação de wagering pra processamento de requisições, ledger, idempotência, reconciliação e os testes de concorrência.
O que ficou de fora: SQS e inbox/outbox não implementados. REFUND e ROLLBACK não implementados (API Retorna 400), sem worker de PENDING_REFERENCE, sem autenticação, sem métricas, logs estruturados e health checks.

## Dinheiro: como é representado no código e no banco, e por quê
O dinheiro foi representado no código como String, convertido em decimal usando a lib 'decimal.js' pra evitar que o computador leia errado as casas decimais.
O banco utiliza numeric(18,2), e a classe MONEY só aceita strings com exatamente 2 casas, deixando-a imutável

## Concorrência: qual estratégia usou na wallet e por quê
**Problema:** duas apostas diferentes podem chegar ao mesmo tempo disputando o saldo da mesma wallet. Se o código lesse o saldo, calculasse e gravasse em passos separados, as duas poderiam passar e o saldo ficaria negativo.

**O que fiz:** o desconto é um único UPDATE com a condição de saldo suficiente dentro do próprio WHERE (`balance >= valor`). O Postgres trava a linha da wallet durante o comando, então a segunda aposta espera e reavalia a condição com o saldo já atualizado. Se nenhuma linha foi alterada, a aposta é registrada como REJECTED (INSUFFICIENT_FUNDS).

**Por que funciona:** verificar e descontar acontecem num comando indivisível, e o lock é por linha (por wallet), então wallets diferentes não se bloqueiam. Quem garante a regra é o banco, não o código. O CHECK (balance >= 0) é a rede de segurança. Limitação: os testes rodaram contra uma única instância da aplicação.

## Idempotência: como funciona e o que acontece com mesma chave e payload diferente
Uma tabela com UNIQUE(idempotency_key), garantindo que se o insert tiver duplicata, o resultado original é retornado.
O payload foi resolvido usando payload_hash, caso o conteúdo seja o mesmo, ele retorna 'idempotentReplay: true', caso seja diferente, ele retorna erro 409.
Algoritmo usado para o Hash: SHA-256 de um JSON com os campos de negócio em ordem fixa; o header e metadados de transporte não entram

## Ledger e imutabilidade: como é garantido no schema
O ledger é gravado com insert na transação que atualiza o saldo, junto com a concorrência.
O trigger recusa UPDATE ou DELETE no ledger, o CHECK confere que saldo_depois = saldo_antes +- valor, o UNIQUE impede dois lançamentos para a mesma transação e a linha do extrato é gravada na mesma transação SQL que altera o saldo, então ambas precisam funcionar para que passe, caso contrário, nenhuma muda.

## O que faria com mais tempo: como desenharia o outbox o consumidor SQS
Não implementei. O desenho que adotaria:

- **Outbox:** na mesma transação SQL que altera o saldo, gravar uma linha de evento numa tabela `outbox`. Um worker separado lê as pendentes (com `FOR UPDATE SKIP LOCKED`, para dois workers não pegarem a mesma), publica no SQS e marca como publicada. Se o processo morrer depois do commit e antes de publicar, outra instância publica.
- **Inbox:** o consumidor registra o `messageId` numa tabela com `UNIQUE (consumer_name, message_id)`, na mesma transação do processamento, para que mensagens duplicadas do SQS não tenham efeito. O ack só acontece depois do commit.
- **Falhas:** erro de negócio é terminal (ack); erro transitório faz retry com backoff; erro permanente ou excesso de tentativas vai para a DLQ.

## Limitações conhecidas: 
**Mapeamento HTTP - 400 payload inválido, 404 wallet inexistente, 409 conflito de idempotência, 422 rejeição de negócio;**

**Sem resposta 202 nem tratamento de falha transitória (503);**

**Testes de concorrência contra uma instância e dependentes do servidor rodando;**

**Sem teste de recuperação após crash.**