/** Keep canvas allocation and PNG rendering behind the explicit export action. */
export async function loadBoardImageExporter() {
	return import('$lib/board-image-export');
}
