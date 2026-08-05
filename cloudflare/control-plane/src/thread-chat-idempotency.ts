type DurableMessageIdentity = {
  id: string;
  role: string;
};

export const existingProgrammaticTurnMessageId = (
  messages: ReadonlyArray<DurableMessageIdentity>,
  clientTurnId: string,
) => messages.find((message) => message.id === clientTurnId && message.role === "user")?.id;
