import { useEffect, useState } from 'react'
import type { DishImage } from '../lib/dishImage'
import { dishEmoji } from '../lib/labels'
import type { MenuItem } from '../types/api'

/** 메뉴 참고 이미지 썸네일. 못 찾거나 이미지가 깨지면 카테고리 이모지로 떨어진다.
 *  이미지는 카드가 관리한다(상세 이미지·저작권 표기와 같은 것을 써야 하므로). */
export function DishThumb({
  item,
  image,
  onClick,
}: {
  item: MenuItem
  image: DishImage | null
  onClick: () => void
}) {
  // 커먼즈 썸네일이 404/오류 등으로 못 뜨면(서비스워커가 일시 오류를 캐시했을 수도) 이모지로.
  const [broken, setBroken] = useState(false)
  useEffect(() => setBroken(false), [image?.url])

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${item.name_translated} 설명 보기`}
      className="relative grid size-14 shrink-0 place-items-center overflow-hidden rounded-[14px] bg-brand-100 text-2xl"
    >
      {image && !broken ? (
        <>
          <img
            src={image.url}
            alt={`${item.name_translated} 참고 이미지`}
            loading="lazy"
            onError={() => setBroken(true)}
            className="size-full object-cover"
          />
          {/* 이 식당의 실제 음식 사진이 아니라는 표시. 작아도 있어야 한다. */}
          <span className="absolute inset-x-0 bottom-0 bg-black/45 text-center text-[8px] font-bold leading-[11px] text-white">
            참고
          </span>
        </>
      ) : (
        dishEmoji(item)
      )}
    </button>
  )
}
