export type Intake = {
  title: string;
  customerName: string;
  description: string;
  quantity: number;
  provisionalQuantity: boolean;
};
export function suggestIntake(message: string): Intake {
  const quantity = message.match(
    /\b([1-9]\d{0,5})\s*(?:unidades?|unid\.?|peças?)\b/i,
  );
  const customer = message.match(/(?:^|\n)\s*cliente\s*:\s*([^\n]+)/i);
  return {
    title:
      message
        .split("\n")
        .find((x) => x.trim())
        ?.trim()
        .slice(0, 150) || "Solicitação de orçamento",
    customerName: customer?.[1].trim().slice(0, 120) || "",
    description: message,
    quantity: quantity ? Number(quantity[1]) : 1,
    provisionalQuantity: !quantity,
  };
}
export function validateIntake(input: any): Intake {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some(
      (k) =>
        ![
          "title",
          "customerName",
          "description",
          "quantity",
          "provisionalQuantity",
        ].includes(k),
    )
  )
    throw Error("Dados da solicitação inválidos.");
  const str = (key: string, max: number, required = false) => {
    const value = input[key];
    if (
      typeof value !== "string" ||
      value.length > max ||
      (required && !value.trim())
    )
      throw Error(`Confira o campo ${key}.`);
    return value.trim();
  };
  const title = str("title", 150, true),
    customerName = str("customerName", 120),
    description = str("description", 4000, true);
  if (
    !Number.isSafeInteger(input.quantity) ||
    input.quantity < 1 ||
    input.quantity > 100000 ||
    typeof input.provisionalQuantity !== "boolean" ||
    (input.provisionalQuantity && input.quantity !== 1)
  )
    throw Error(
      "Quantidade deve ser inteira entre 1 e 100.000; quantidade provisória deve ser 1.",
    );
  return {
    title,
    customerName,
    description,
    quantity: input.quantity,
    provisionalQuantity: input.provisionalQuantity,
  };
}
