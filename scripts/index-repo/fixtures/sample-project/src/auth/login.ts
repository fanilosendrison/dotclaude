// @spec SPEC-001
export async function login(
	_email: string,
	_password: string,
): Promise<string> {
	return "token";
}

export async function logout(_token: string): Promise<void> {}
