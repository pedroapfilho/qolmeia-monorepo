import { Img } from "react-email";

type QolmeiaLogoProps = {
  height?: number;
  width?: number;
};

const QolmeiaLogo = ({ height = 32, width = 120 }: QolmeiaLogoProps) => {
  return (
    <Img
      alt="Qolmeia"
      height={height}
      src="https://www.qolmeia.ai/logo-wordmark.svg"
      width={width}
    />
  );
};

export { QolmeiaLogo };
