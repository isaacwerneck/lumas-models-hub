# Engenharia de Requisitos

## Atores
- Chatter
- Gerente

# Requisitos minimos

## Login
- Login de Chatter (nome e senha)
- Login de Gerente (nome e senha)
- Só terá opção de entrar, não de criar conta. A conta será criada antes e as credenciais mandadas para os usuários. Assim eles podem alterar as informações nas configurações

## Chatter
- Chatter tem que conseguir subir imagem do valor que está iniciando seu periodo de trabalho
- Chatter tem que conseguir subir imagem do valor que está fechando seu periodo de trabalho
- Algoritmo para ler os valores nas imagens, calcular quanto cada chatter fez em seu periodo de trabalho, dividir por 4 e armazenar esse valor
- O pagamento será efetuado toda segunda-feira, então o Chatter terá uma view com várias informações sobre o pagamento:
    - Quanto ele já acumulou de dinheiro na semana
    - Quanto ele já recebeu ao todo na vida dele
    - Quantos dias faltam até o pagamento
    - Quando o pagamento foi efetuado ou não
- Nessa mesma view, o Chatter além de poder consultar suas informações, terá que toda segunda-feira, verificar seus honorarios e confirmar todos os valores e horarios, antes de poder receber seu pagamento. (só possivel as segundas)
- Terá um chat lateral também onde os chatters da mesma modelo poderão conversar entre si

## Gerente
- Conseguirá ver todos os perfis de todos os Chatters e conseguirá visualizar todas suas informações (Dinheiro feito, horarios trabalhados, nome, modelo etc)
- Conseguirá participar de todos os bate-papos, independentemente.
- Conseguirá criar tags de modelo para definir qual modelo cada Chatter irá administrar
- Terá uma view de pagamento onde terá as seguintes informações:
    - Irá aparecer uma lista de apenas os Chatters que confirmaram seus honorários
    - Terá um botão do lado de cada perfil de Chatter onde confirmará o pagamento do mesmo, o Gerente terá que aciona-lo assim que o pagamento do Chatter for confirmado, para que o Chatter tenha esse feedback visual em sua view de pagamento

# Obs
- Cada Chatter tem sua view individual, eles não conseguirão ver informações de outros chatters, apenas trocar mensagens no bate-papo se tiver outro chatter com a mesma modelo.

- Só irá pedir o login 1 vez, dps quero que sempre entre automaticamente já logado