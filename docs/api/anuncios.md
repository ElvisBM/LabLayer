# API de rascunhos de anúncios da LabLayer

Base: `https://app.lablayer.com.br/api/tenants/{tenantId}/listing-drafts`.

Use os campos `apiKey`, `tenantId` e `baseUrl` do arquivo `chave-anuncios.json`. A mesma chave permite enviar fotos, criar, consultar e editar rascunhos. Aprovação e publicação exigem um administrador conectado à LabLayer.

## 1. Subir uma foto para o servidor

`POST {baseUrl}/photos`

Envie **um arquivo por requisição, como corpo binário**. Não use JSON, base64 nem `multipart/form-data` nesse endpoint.

Headers:

```http
Authorization: Bearer SUA_CHAVE
Content-Type: image/jpeg
```

Tipos aceitos: `image/jpeg`, `image/png`, `image/webp`. Máximo de 10 MiB por arquivo e 40 megapixels. Somente imagens estáticas. A imagem é validada e salva como JPEG, com orientação corrigida, fundo branco para transparência e lado máximo de 2560 pixels. Metadados, incluindo localização, são removidos. Imagens menores não são ampliadas.

```bash
curl --fail-with-body \
  -X POST "$LABLAYER_BASE_URL/photos" \
  -H "Authorization: Bearer $LABLAYER_API_KEY" \
  -H "Content-Type: image/jpeg" \
  --data-binary "@/caminho/foto.jpg"
```

Use `Content-Type: image/png` para PNG ou `image/webp` para WebP. As variáveis devem conter os valores do seu arquivo de acesso; não inclua a chave na URL.

Resposta `201 Created` (ou `200 OK` ao reenviar o mesmo arquivo):

```json
{
  "id": "identificador-da-foto",
  "url": "https://app.lablayer.com.br/api/listing-photos/identificador-da-foto.jpg",
  "mime": "image/jpeg",
  "size": 125000,
  "width": 1600,
  "height": 1200
}
```

O identificador real contém 64 caracteres hexadecimais. O campo `url` é o link pronto para inserir em `pictures`. Não é necessário nem correto anexar a chave a esse link. Ele é acessível a quem possui a URL, inclusive o Mercado Livre. A foto fica armazenada fora da pasta da aplicação e permanece após novas publicações do sistema. Remover o link de um rascunho não apaga o arquivo hospedado.

Reenviar o mesmo arquivo para a mesma empresa devolve o mesmo link. O upload não cria um rascunho, não aprova e não publica anúncio.

## 2. Criar um rascunho com as fotos

`POST {baseUrl}`

Headers: `Authorization: Bearer SUA_CHAVE` e `Content-Type: application/json`.

```json
{
  "externalId": "chaveiro-001",
  "title": "Chaveiro personalizado em impressão 3D",
  "description": "Chaveiro em PLA com nome personalizado.",
  "price": 25.90,
  "quantity": 10,
  "pictures": ["COLE_AQUI_O_CAMPO_url_RETORNADO_PELO_UPLOAD"],
  "categoryId": "",
  "condition": "new",
  "listingTypeId": "gold_special",
  "attributes": [{"id":"BRAND","value_name":"LabLayer"}],
  "saleTerms": [],
  "shipping": {"mode":"me2","local_pick_up":false,"free_shipping":false}
}
```

`pictures` aceita até 12 URLs HTTPS, incluindo as devolvidas pelo upload da LabLayer. Também aceita URLs externas públicas.

`externalId` é a referência única da sua integração (até 100 caracteres: letras, números, ponto, hífen e sublinhado). Repetir os mesmos dados não duplica o rascunho. Dados diferentes com a mesma referência retornam 409; nesse caso use a edição com revisão.

Título: até 60 caracteres. Descrição: até 5000. Preço: número com até duas casas decimais, não negativo. Quantidade: inteiro entre 1 e 999999. Pode enviar categoria vazia, preço zero e fotos vazias para completar depois. A aprovação exige dados completos e validados pelo Mercado Livre.

Condição: `new` ou `used`. Tipo de anúncio: `gold_special` (Clássico) ou `gold_pro` (Premium). Categoria: código MLB seguido de números, correspondente ao produto. Atributos e condições de venda usam `id` e `value_name` e/ou `value_id`; as exigências variam por categoria.

A resposta contém `id`, `data`, `revision`, `status`, `createdAt` e `updatedAt`. Guarde `id` e `revision` para consultar e editar. Status inicial: `draft`.

## 3. Consultar e anexar fotos a um rascunho existente

- `GET {baseUrl}`: lista até 100 rascunhos. Se houver `nextCursor`, continue com `?after={nextCursor}`.
- `GET {baseUrl}/{id}`: retorna o rascunho e a revisão atual.
- `POST {baseUrl}/{id}/save`: substitui os dados do rascunho.

Para adicionar uma foto: faça o upload, consulte o rascunho, acrescente o `url` em `data.pictures`, preservando os links existentes, e envie:

```json
{
  "revision": 1,
  "data": {
    "externalId": "chaveiro-001",
    "title": "Chaveiro personalizado em impressão 3D",
    "description": "Chaveiro em PLA com nome personalizado.",
    "price": 25.90,
    "quantity": 10,
    "pictures": ["URL_DA_FOTO_ANTERIOR", "URL_DA_NOVA_FOTO"],
    "categoryId": "",
    "condition": "new",
    "listingTypeId": "gold_special",
    "attributes": [{"id":"BRAND","value_name":"LabLayer"}],
    "saleTerms": [],
    "shipping": {"mode":"me2","local_pick_up":false,"free_shipping":false}
  }
}
```

Substitua os exemplos de URL pelos links reais. Envie os dados completos retornados pela consulta com a alteração desejada. A revisão deve ser a mais recente. Alterar um rascunho aprovado remove a aprovação; rascunhos já enviados para publicação não podem ser alterados por essa operação.

## 4. Revisar e publicar

Abra https://app.lablayer.com.br/?view=anuncios&tab=rascunhos.

Abra o rascunho, revise as fotos e os dados, salve alterações, clique em **Validar e aprovar rascunho**, depois **Publicar no Mercado Livre** e **Confirmar publicação**. Também é possível enviar fotos diretamente pelo campo de arquivos da tela de revisão; após o upload, clique em **Salvar alterações** para anexá-las ao rascunho.

A chave de integração não possui permissão para aprovar ou publicar. Um anúncio simples por rascunho; variações e kits não estão incluídos neste contrato.

## Códigos de resposta

| Código | Significado |
|---|---|
| 200 / 201 | Operação concluída; consulte o JSON retornado. |
| 400 | Corpo inválido ou campo obrigatório ausente. |
| 401 | Chave inválida ou revogada. |
| 403 | Operação não permitida ou outra empresa. |
| 404 | Rascunho/foto inexistente. |
| 409 | Referência duplicada com dados diferentes, revisão antiga ou estado incompatível. |
| 413 | Foto acima de 10 MiB. |
| 415 | Tipo de envio não suportado. |
| 422 | Imagem inválida ou restrição de validação. |
| 503 | Armazenamento temporariamente indisponível. |

Erros autenticados retornam `{ "error": "mensagem" }`. A rota pública da foto pode responder sem corpo em caso de erro.
